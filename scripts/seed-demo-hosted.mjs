#!/usr/bin/env node
/* ============================================================================
 * scripts/seed-demo-hosted.mjs — idempotent demo fixture for a HOSTED stack.
 *
 * SERVER-SIDE SCRIPT ONLY. Uses the service-role key (bypasses RLS) and must
 * never be imported by the app or run in a browser context (CLAUDE.md:
 * service-role key is server-only, never in client bundles).
 *
 * What it does (safe to re-run):
 *   1. Creates the shared demo auth user (email confirmed) via the GoTrue
 *      admin API; if the user already exists (422), looks up its id via the
 *      admin list filter instead.
 *   2. Upserts (Prefer: resolution=merge-duplicates) the demo tenancy chain
 *      through PostgREST: organization -> owner membership -> project ->
 *      document, all with fixed UUIDs so reruns converge on the same rows.
 *   3. Prints the studio URL path for the seeded document.
 *
 * Environment (required):
 *   SUPABASE_URL               e.g. https://xyzcompany.supabase.co
 *   SUPABASE_SERVICE_ROLE_KEY  service-role key (server-only secret)
 *
 * Optional overrides:
 *   DEMO_EMAIL     default demo@nullfellows.dev
 *   DEMO_PASSWORD  default intent-demo-2026
 *
 * Usage:
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/seed-demo-hosted.mjs
 *
 * Exits nonzero on any real failure.
 * ==========================================================================*/

const SUPABASE_URL = (process.env.SUPABASE_URL ?? '').replace(/\/+$/, '');
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

const DEMO_EMAIL = process.env.DEMO_EMAIL || 'demo@nullfellows.dev';
const DEMO_PASSWORD = process.env.DEMO_PASSWORD || 'intent-demo-2026';

// Fixed UUIDs — must match supabase/seed.sql so local and hosted agree.
const ORG_ID = '11111111-1111-4111-8111-111111111111';
const PROJECT_ID = '22222222-2222-4222-8222-222222222222';
const DOCUMENT_ID = '33333333-3333-4333-8333-333333333333';

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error(
    'Missing required env: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must both be set.',
  );
  process.exit(1);
}

const baseHeaders = {
  apikey: SERVICE_ROLE_KEY,
  Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
  'Content-Type': 'application/json',
};

/** POST an upsert through PostgREST; service role bypasses RLS. */
async function upsert(table, row, onConflict) {
  const url = `${SUPABASE_URL}/rest/v1/${table}?on_conflict=${encodeURIComponent(onConflict)}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      ...baseHeaders,
      Prefer: 'resolution=merge-duplicates,return=representation',
    },
    body: JSON.stringify(row),
  });

  const body = await res.text();

  if (!res.ok) {
    throw new Error(`upsert ${table} failed: HTTP ${res.status} — ${body}`);
  }

  console.log(`  upserted ${table} (on_conflict=${onConflict})`);

  return JSON.parse(body);
}

/** Create the demo auth user; on 422 (already exists) resolve its id. */
async function ensureDemoUser() {
  const createRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
    method: 'POST',
    headers: baseHeaders,
    body: JSON.stringify({
      email: DEMO_EMAIL,
      password: DEMO_PASSWORD,
      email_confirm: true,
      user_metadata: { full_name: 'Demo User' },
    }),
  });

  if (createRes.ok) {
    const user = await createRes.json();
    console.log(`  created auth user ${DEMO_EMAIL} (${user.id})`);

    return user.id;
  }

  const errBody = await createRes.text();

  if (createRes.status !== 422) {
    throw new Error(`create auth user failed: HTTP ${createRes.status} — ${errBody}`);
  }

  // 422: user already exists — find its id via the admin list filter.
  const listRes = await fetch(
    `${SUPABASE_URL}/auth/v1/admin/users?filter=${encodeURIComponent(DEMO_EMAIL)}&page=1&per_page=50`,
    { headers: baseHeaders },
  );

  if (!listRes.ok) {
    throw new Error(`admin list users failed: HTTP ${listRes.status} — ${await listRes.text()}`);
  }

  const listBody = await listRes.json();
  const users = Array.isArray(listBody) ? listBody : (listBody.users ?? []);
  const existing = users.find((u) => u.email?.toLowerCase() === DEMO_EMAIL.toLowerCase());

  if (!existing) {
    throw new Error(
      `auth user ${DEMO_EMAIL} reported as existing (422) but not found via admin list filter`,
    );
  }

  console.log(`  auth user ${DEMO_EMAIL} already exists (${existing.id})`);

  return existing.id;
}

async function main() {
  console.log(`Seeding demo fixtures on ${SUPABASE_URL} ...`);

  const userId = await ensureDemoUser();

  await upsert(
    'organizations',
    {
      id: ORG_ID,
      name: 'Demo Workspace',
      slug: 'demo-workspace',
      settings: { schema_version: 1 },
    },
    'id',
  );

  // No fixed membership id: the natural key is (organization_id, user_id),
  // and merge-duplicates on it keeps reruns idempotent + role pinned to owner.
  await upsert(
    'organization_members',
    { organization_id: ORG_ID, user_id: userId, role: 'owner' },
    'organization_id,user_id',
  );

  await upsert(
    'projects',
    {
      id: PROJECT_ID,
      organization_id: ORG_ID,
      name: 'Demo Project',
      description: 'Shared demo workspace project (seeded by scripts/seed-demo-hosted.mjs).',
      settings: { schema_version: 1 },
    },
    'id',
  );

  await upsert(
    'documents',
    {
      id: DOCUMENT_ID,
      project_id: PROJECT_ID,
      organization_id: ORG_ID,
      title: 'The Case for Legible AI Writing',
      kind: 'document',
    },
    'id',
  );

  console.log('');
  console.log('Done. Demo studio path:');
  console.log(`  /studio/${DOCUMENT_ID}`);
}

main().catch((error) => {
  console.error(`Seed failed: ${error.message}`);
  process.exit(1);
});
