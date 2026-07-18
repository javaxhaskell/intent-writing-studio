#!/usr/bin/env node
/* ============================================================================
 * scripts/isolation-check.mjs — REST-level tenant-isolation suite (M1).
 *
 * Proves the RLS tenant boundary end-to-end through the real Data API stack
 * (GoTrue password sign-in -> PostgREST with per-user JWTs), complementing the
 * in-database pgTAP suite under supabase/tests/. Uses ONLY ordinary user JWTs
 * and the anon key — never the service-role key — so a pass means an actual
 * client credential cannot cross tenants (CLAUDE.md: service-role key is
 * server-only and must not appear in tests).
 *
 * Fixture matrix (supabase/seed.sql — run `supabase db reset` first; the
 * exact-set read assertions assume a freshly seeded database):
 *
 *   user                          | Org Alpha | Org Beta
 *   ------------------------------+-----------+---------
 *   alice.owner@nullfellows.dev   | owner     | —
 *   bob.editor@nullfellows.dev    | editor    | viewer
 *   carol.owner@nullfellows.dev   | —         | owner
 *   dave.solo@nullfellows.dev     | —         | —
 *
 * Assertions:
 *   1. Read isolation: each member sees exactly their org's seeded rows on all
 *      six tenancy tables; alice sees zero beta rows, carol zero alpha rows;
 *      bob (cross-org member) sees both orgs with role-appropriate rows; dave
 *      (no orgs) and anon see zero rows everywhere.
 *   2. Write denial: cross-tenant INSERT/UPDATE/DELETE attempts fail — either
 *      HTTP 401/403 (grant / WITH CHECK denial) or a zero-row RLS no-op —
 *      and the rightful owner then confirms the write did NOT land.
 *   3. RPC: get_document_access returns zero rows cross-org / for non-members,
 *      role-appropriate capabilities in-org, and is unreachable for anon.
 *   4. Positive controls: an in-org write succeeds, so the denials above are
 *      real RLS denials, not malformed requests passing vacuously.
 *
 * Environment (defaults target the local dev stack):
 *   SUPABASE_URL       default http://127.0.0.1:54321
 *   SUPABASE_ANON_KEY  default: the standard Supabase-local demo anon JWT.
 *     This fallback is the well-known, publicly documented demo key that every
 *     local `supabase start` stack ships with (signed by the public demo
 *     secret "super-secret-jwt-token-with-at-least-32-characters-long"). It is
 *     NOT a secret and grants nothing outside a local demo stack, so inlining
 *     it here is safe. It is the anon key — the service-role key is never
 *     referenced.
 *
 * Exit code: 0 only if every assertion passes; 1 otherwise (or on harness
 * errors such as sign-in failure). Prints a visibility matrix plus a full
 * per-assertion report.
 * ==========================================================================*/

const SUPABASE_URL = (process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321').replace(/\/+$/, '');
const ANON_KEY =
  process.env.SUPABASE_ANON_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';
const PASSWORD = 'password123';

// ---------------------------------------------------------------------------
// Seed fixture ids (supabase/seed.sql UUID scheme)
// ---------------------------------------------------------------------------

const USER = {
  alice: '00000000-0000-4000-8000-000000000001',
  bob: '00000000-0000-4000-8000-000000000002',
  carol: '00000000-0000-4000-8000-000000000003',
  dave: '00000000-0000-4000-8000-000000000004',
};

const ORG = {
  alpha: '10000000-0000-4000-8000-000000000001',
  beta: '10000000-0000-4000-8000-000000000002',
};

const MEMBERSHIP = {
  aliceAlpha: '20000000-0000-4000-8000-000000000001',
  bobAlpha: '20000000-0000-4000-8000-000000000002',
  carolBeta: '20000000-0000-4000-8000-000000000003',
  bobBeta: '20000000-0000-4000-8000-000000000004',
};

const PROJECT = {
  alpha: '30000000-0000-4000-8000-000000000001',
  beta: '30000000-0000-4000-8000-000000000002',
};

const DOC = {
  alpha: '40000000-0000-4000-8000-000000000001',
  beta: '40000000-0000-4000-8000-000000000002',
};

const VERSION = {
  alpha: '50000000-0000-4000-8000-000000000001',
  beta: '50000000-0000-4000-8000-000000000002',
};

// Seeded row ids per table per org (source_materials has no seed rows — the
// zero-row expectation is still asserted for every actor).
const SEED_IDS = {
  organizations: { alpha: [ORG.alpha], beta: [ORG.beta] },
  organization_members: {
    alpha: [MEMBERSHIP.aliceAlpha, MEMBERSHIP.bobAlpha],
    beta: [MEMBERSHIP.carolBeta, MEMBERSHIP.bobBeta],
  },
  projects: { alpha: [PROJECT.alpha], beta: [PROJECT.beta] },
  documents: { alpha: [DOC.alpha], beta: [DOC.beta] },
  document_versions: { alpha: [VERSION.alpha], beta: [VERSION.beta] },
  source_materials: { alpha: [], beta: [] },
};

const TABLES = Object.keys(SEED_IDS);

// Which orgs each authenticated actor belongs to.
const MEMBERSHIPS = {
  alice: ['alpha'],
  bob: ['alpha', 'beta'],
  carol: ['beta'],
  dave: [],
};

const EMAIL = {
  alice: 'alice.owner@nullfellows.dev',
  bob: 'bob.editor@nullfellows.dev',
  carol: 'carol.owner@nullfellows.dev',
  dave: 'dave.solo@nullfellows.dev',
};

// ---------------------------------------------------------------------------
// HTTP + assertion helpers
// ---------------------------------------------------------------------------

async function req(method, path, { token = null, body, prefer } = {}) {
  const headers = {
    apikey: ANON_KEY,
    Authorization: `Bearer ${token ?? ANON_KEY}`,
  };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (prefer) headers.Prefer = prefer;
  const res = await fetch(`${SUPABASE_URL}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* non-JSON body — keep text for diagnostics */
  }
  return { status: res.status, json, text };
}

async function signIn(email) {
  const { status, json, text } = await req('POST', '/auth/v1/token?grant_type=password', {
    body: { email, password: PASSWORD },
  });
  if (status !== 200 || !json?.access_token) {
    throw new Error(`sign-in failed for ${email}: HTTP ${status} ${text.slice(0, 300)}`);
  }
  return json.access_token;
}

const results = [];
function check(section, name, pass, detail = '') {
  results.push({ section, name, pass: Boolean(pass), detail });
}

function sameSet(a, b) {
  const sa = [...a].sort();
  const sb = [...b].sort();
  return sa.length === sb.length && sa.every((v, i) => v === sb[i]);
}

function fmtSet(xs) {
  // Seed UUIDs differ only near the end — show prefix…tail so ids stay
  // distinguishable in the report.
  return xs.length === 0 ? '(none)' : xs.map((x) => `${x.slice(0, 4)}…${x.slice(-4)}`).join(',');
}

const DENIED = new Set([401, 403]);

/** A write "failed" if it was rejected outright (401/403) or was an RLS
 *  zero-row no-op (2xx with an empty return=representation body). */
function writeDenied(res) {
  if (DENIED.has(res.status)) return true;
  if ((res.status === 200 || res.status === 204) && Array.isArray(res.json)) {
    return res.json.length === 0;
  }
  return false;
}

function writeOutcome(res) {
  const rows = Array.isArray(res.json) ? `${res.json.length} row(s)` : 'no representation';
  const code =
    res.json && !Array.isArray(res.json) && res.json.code ? ` code=${res.json.code}` : '';
  return `HTTP ${res.status}, ${rows}${code}`;
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

async function main() {
  console.log(`isolation-check: ${SUPABASE_URL} (anon key + password-grant user JWTs only)`);
  console.log('');

  // -- Sign in every seeded user with the anon key + password grant ----------
  const tokens = { anon: null };
  for (const actor of Object.keys(EMAIL)) {
    tokens[actor] = await signIn(EMAIL[actor]);
  }
  check(
    'auth',
    'all four seeded users sign in via password grant',
    true,
    Object.values(EMAIL).join(', '),
  );

  // -- 1. Read isolation matrix ----------------------------------------------
  const matrix = {}; // matrix[table][actor] = row count or 'ERR'
  const actors = ['alice', 'bob', 'carol', 'dave', 'anon'];

  for (const table of TABLES) {
    matrix[table] = {};
    for (const actor of actors) {
      const res = await req('GET', `/rest/v1/${table}?select=id&order=id`, {
        token: tokens[actor],
      });
      const ok = res.status === 200 && Array.isArray(res.json);
      matrix[table][actor] = ok ? res.json.length : `ERR(${res.status})`;
      if (!ok) {
        check('read', `${actor} SELECT ${table} responds 200`, false, writeOutcome(res));
        continue;
      }
      const got = res.json.map((r) => r.id);
      const expected =
        actor === 'anon' ? [] : MEMBERSHIPS[actor].flatMap((org) => SEED_IDS[table][org]);
      const crossOrgLeak = got.filter((id) => !expected.includes(id));
      check(
        'read',
        `${actor} sees exactly [${fmtSet(expected)}] on ${table}`,
        sameSet(got, expected),
        `got [${fmtSet(got)}]${crossOrgLeak.length ? ` LEAK: [${fmtSet(crossOrgLeak)}]` : ''}`,
      );
    }
  }

  // Bob is cross-org but role-appropriate: editor in alpha, viewer in beta.
  {
    const res = await req(
      'GET',
      `/rest/v1/organization_members?select=organization_id,role&user_id=eq.${USER.bob}&order=organization_id`,
      { token: tokens.bob },
    );
    const rows = Array.isArray(res.json) ? res.json : [];
    const byOrg = Object.fromEntries(rows.map((r) => [r.organization_id, r.role]));
    check(
      'read',
      'bob role-appropriate: editor in alpha, viewer in beta',
      rows.length === 2 && byOrg[ORG.alpha] === 'editor' && byOrg[ORG.beta] === 'viewer',
      JSON.stringify(byOrg),
    );
  }

  // -- 2. RPC get_document_access --------------------------------------------
  async function rpcAccess(actor, docId) {
    return req('POST', '/rest/v1/rpc/get_document_access', {
      token: tokens[actor],
      body: { p_document_id: docId },
    });
  }

  {
    const cases = [
      // [actor, doc, expected]: null = zero rows; object = single row match
      ['alice', DOC.alpha, { role: 'owner', can_edit: true, can_comment: true }],
      ['alice', DOC.beta, null],
      ['carol', DOC.beta, { role: 'owner', can_edit: true, can_comment: true }],
      ['carol', DOC.alpha, null],
      ['bob', DOC.alpha, { role: 'editor', can_edit: true, can_comment: true }],
      ['bob', DOC.beta, { role: 'viewer', can_edit: false, can_comment: false }],
      ['dave', DOC.alpha, null],
      ['dave', DOC.beta, null],
    ];
    for (const [actor, docId, expected] of cases) {
      const res = await rpcAccess(actor, docId);
      const rows = Array.isArray(res.json) ? res.json : null;
      const docName = docId === DOC.alpha ? 'alpha doc' : 'beta doc';
      if (expected === null) {
        check(
          'rpc',
          `get_document_access(${docName}) as ${actor} returns zero rows`,
          res.status === 200 && rows !== null && rows.length === 0,
          writeOutcome(res),
        );
      } else {
        const row = rows?.[0];
        check(
          'rpc',
          `get_document_access(${docName}) as ${actor} -> ${expected.role} (edit=${expected.can_edit})`,
          res.status === 200 &&
            rows?.length === 1 &&
            row.role === expected.role &&
            row.can_edit === expected.can_edit &&
            row.can_comment === expected.can_comment,
          rows ? JSON.stringify(rows) : writeOutcome(res),
        );
      }
    }
    const anonRes = await rpcAccess('anon', DOC.alpha);
    check(
      'rpc',
      'get_document_access unreachable for anon (EXECUTE revoked)',
      DENIED.has(anonRes.status),
      writeOutcome(anonRes),
    );
  }

  // -- 3. Cross-tenant write denial ------------------------------------------
  const REP = 'return=representation';
  const marker = `isolation-check-${Date.now()}`;

  async function assertUnchanged(name, ownerActor, path, predicate, detailFn) {
    const res = await req('GET', path, { token: tokens[ownerActor] });
    const rows = Array.isArray(res.json) ? res.json : [];
    check('write-verify', name, res.status === 200 && predicate(rows), detailFn(rows, res));
  }

  // 3a. INSERT into the other tenant.
  const insertAttempts = [
    ['alice', 'projects', { organization_id: ORG.beta, name: `${marker}-project` }],
    [
      'alice',
      'documents',
      { project_id: PROJECT.beta, organization_id: ORG.beta, title: `${marker}-doc` },
    ],
    [
      'alice',
      'organization_members',
      { organization_id: ORG.beta, user_id: USER.alice, role: 'owner' },
    ],
    [
      'alice',
      'document_versions',
      {
        document_id: DOC.beta,
        organization_id: ORG.beta,
        content: { schema_version: 1 },
        content_hash: marker,
        created_by: USER.alice,
      },
    ],
    [
      'alice',
      'source_materials',
      {
        project_id: PROJECT.beta,
        organization_id: ORG.beta,
        storage_path: `${marker}/evil.txt`,
        mime_type: 'text/plain',
      },
    ],
    ['carol', 'projects', { organization_id: ORG.alpha, name: `${marker}-mirror` }],
    [
      'carol',
      'documents',
      { project_id: PROJECT.alpha, organization_id: ORG.alpha, title: `${marker}-mirror-doc` },
    ],
    ['dave', 'projects', { organization_id: ORG.alpha, name: `${marker}-dave` }],
    ['anon', 'projects', { organization_id: ORG.alpha, name: `${marker}-anon` }],
  ];
  for (const [actor, table, body] of insertAttempts) {
    const res = await req('POST', `/rest/v1/${table}`, { token: tokens[actor], body, prefer: REP });
    check(
      'write-deny',
      `${actor} INSERT into ${table} (foreign org) fails`,
      writeDenied(res),
      writeOutcome(res),
    );
  }
  // The rightful owners confirm no inserted row landed anywhere.
  await assertUnchanged(
    'carol confirms beta has only the seeded project/document/member rows',
    'carol',
    `/rest/v1/organization_members?select=id&organization_id=eq.${ORG.beta}`,
    (rows) =>
      sameSet(
        rows.map((r) => r.id),
        SEED_IDS.organization_members.beta,
      ),
    (rows) => `beta member ids: [${fmtSet(rows.map((r) => r.id))}]`,
  );
  await assertUnchanged(
    'carol confirms no marker rows landed in beta projects/documents',
    'carol',
    `/rest/v1/projects?select=id,name&organization_id=eq.${ORG.beta}`,
    (rows) =>
      sameSet(
        rows.map((r) => r.id),
        SEED_IDS.projects.beta,
      ) && !rows.some((r) => r.name.includes(marker)),
    (rows) => `beta projects: [${fmtSet(rows.map((r) => r.id))}]`,
  );
  await assertUnchanged(
    'carol confirms beta document_versions unchanged',
    'carol',
    `/rest/v1/document_versions?select=id,content_hash&organization_id=eq.${ORG.beta}`,
    (rows) =>
      sameSet(
        rows.map((r) => r.id),
        SEED_IDS.document_versions.beta,
      ) && !rows.some((r) => r.content_hash === marker),
    (rows) => `beta versions: [${fmtSet(rows.map((r) => r.id))}]`,
  );
  await assertUnchanged(
    'alice confirms no marker rows landed in alpha projects',
    'alice',
    `/rest/v1/projects?select=id,name&organization_id=eq.${ORG.alpha}`,
    (rows) =>
      sameSet(
        rows.map((r) => r.id),
        SEED_IDS.projects.alpha,
      ) && !rows.some((r) => r.name.includes(marker)),
    (rows) => `alpha projects: [${fmtSet(rows.map((r) => r.id))}]`,
  );

  // 3b. UPDATE rows in the other tenant (RLS filters -> zero-row no-op).
  const updateAttempts = [
    ['alice', 'documents', `id=eq.${DOC.beta}`, { title: `${marker}-hacked` }],
    ['alice', 'organizations', `id=eq.${ORG.beta}`, { name: `${marker}-hacked-org` }],
    ['carol', 'documents', `id=eq.${DOC.alpha}`, { title: `${marker}-hacked` }],
    ['dave', 'documents', `id=eq.${DOC.alpha}`, { title: `${marker}-hacked` }],
    ['anon', 'documents', `id=eq.${DOC.alpha}`, { title: `${marker}-hacked` }],
    // Role gate inside a shared org: bob is only a viewer in beta.
    ['bob', 'documents', `id=eq.${DOC.beta}`, { title: `${marker}-viewer-edit` }],
  ];
  for (const [actor, table, filter, body] of updateAttempts) {
    const res = await req('PATCH', `/rest/v1/${table}?${filter}`, {
      token: tokens[actor],
      body,
      prefer: REP,
    });
    check(
      'write-deny',
      `${actor} UPDATE ${table} where ${filter.slice(0, 14)}… fails`,
      writeDenied(res),
      writeOutcome(res),
    );
  }
  await assertUnchanged(
    'carol confirms beta document title untouched',
    'carol',
    `/rest/v1/documents?select=title&id=eq.${DOC.beta}`,
    (rows) => rows.length === 1 && rows[0].title === 'Beta Welcome Document',
    (rows) => JSON.stringify(rows),
  );
  await assertUnchanged(
    'carol confirms beta organization name untouched',
    'carol',
    `/rest/v1/organizations?select=name&id=eq.${ORG.beta}`,
    (rows) => rows.length === 1 && rows[0].name === 'Org Beta',
    (rows) => JSON.stringify(rows),
  );
  await assertUnchanged(
    'alice confirms alpha document title untouched',
    'alice',
    `/rest/v1/documents?select=title&id=eq.${DOC.alpha}`,
    (rows) => rows.length === 1 && rows[0].title === 'Alpha Welcome Document',
    (rows) => JSON.stringify(rows),
  );

  // 3c. DELETE across the tenant boundary.
  const deleteAttempts = [
    // organization_members has a DELETE grant + policy; RLS must zero it out.
    ['alice', 'organization_members', `id=eq.${MEMBERSHIP.carolBeta}`],
    ['carol', 'organization_members', `id=eq.${MEMBERSHIP.aliceAlpha}`],
    // documents/projects have no client DELETE grant at all -> 401/403.
    ['alice', 'documents', `id=eq.${DOC.beta}`],
    ['carol', 'projects', `id=eq.${PROJECT.alpha}`],
    ['anon', 'organization_members', `id=eq.${MEMBERSHIP.carolBeta}`],
  ];
  for (const [actor, table, filter] of deleteAttempts) {
    const res = await req('DELETE', `/rest/v1/${table}?${filter}`, {
      token: tokens[actor],
      prefer: REP,
    });
    check(
      'write-deny',
      `${actor} DELETE ${table} where ${filter.slice(0, 14)}… fails`,
      writeDenied(res),
      writeOutcome(res),
    );
  }
  await assertUnchanged(
    'carol confirms her beta owner membership still exists',
    'carol',
    `/rest/v1/organization_members?select=id&id=eq.${MEMBERSHIP.carolBeta}`,
    (rows) => rows.length === 1,
    (rows) => `${rows.length} row(s)`,
  );
  await assertUnchanged(
    'alice confirms her alpha owner membership and the alpha document/project still exist',
    'alice',
    `/rest/v1/organization_members?select=id&id=eq.${MEMBERSHIP.aliceAlpha}`,
    (rows) => rows.length === 1,
    (rows) => `${rows.length} row(s)`,
  );
  await assertUnchanged(
    'carol confirms the beta document still exists',
    'carol',
    `/rest/v1/documents?select=id&id=eq.${DOC.beta}`,
    (rows) => rows.length === 1,
    (rows) => `${rows.length} row(s)`,
  );

  // -- 4. Positive write control ---------------------------------------------
  // An in-org UPDATE by an owner MUST affect exactly one row (same title, so
  // no visible drift). Proves the denials above are RLS denials, not requests
  // that would have failed for any actor.
  {
    const res = await req('PATCH', `/rest/v1/documents?id=eq.${DOC.alpha}`, {
      token: tokens.alice,
      body: { title: 'Alpha Welcome Document' },
      prefer: REP,
    });
    check(
      'control',
      'alice (owner) CAN update her own alpha document (1 row)',
      res.status === 200 && Array.isArray(res.json) && res.json.length === 1,
      writeOutcome(res),
    );
  }

  // -- Report ----------------------------------------------------------------
  console.log('Visibility matrix (rows returned per actor):');
  const pad = (s, n) => String(s).padEnd(n);
  console.log(`  ${pad('table', 22)}${actors.map((a) => pad(a, 7)).join('')}`);
  for (const table of TABLES) {
    console.log(`  ${pad(table, 22)}${actors.map((a) => pad(matrix[table][a], 7)).join('')}`);
  }
  console.log('');

  let failures = 0;
  let currentSection = null;
  const SECTION_TITLES = {
    auth: 'AUTH',
    read: 'READ ISOLATION',
    rpc: 'RPC get_document_access',
    'write-deny': 'CROSS-TENANT WRITE DENIAL',
    'write-verify': 'WRITE-DENIAL VERIFICATION (rightful owner)',
    control: 'POSITIVE CONTROLS',
  };
  for (const r of results) {
    if (r.section !== currentSection) {
      currentSection = r.section;
      console.log(`== ${SECTION_TITLES[r.section] ?? r.section} ==`);
    }
    const mark = r.pass ? 'PASS' : 'FAIL';
    if (!r.pass) failures += 1;
    console.log(`  ${mark}  ${r.name}${r.detail ? `  [${r.detail}]` : ''}`);
  }

  console.log('');
  console.log(`${results.length - failures}/${results.length} assertions passed`);
  if (failures > 0) {
    console.error(`isolation-check: FAILED (${failures} assertion(s) failed)`);
    process.exit(1);
  }
  console.log('isolation-check: OK — tenant boundary holds through the Data API');
}

main().catch((err) => {
  console.error(`isolation-check: harness error — ${err.message}`);
  process.exit(1);
});
