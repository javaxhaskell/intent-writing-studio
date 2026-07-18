import { test, expect, type Page } from '@playwright/test';

/**
 * M1 two-org isolation E2E (real browser, real Supabase local stack).
 *
 * Proves, with an ordinary user session obtained through the actual magic-link
 * flow (anon key + user JWT only — the service-role key is never used), that:
 *
 *   1. alice (owner of Org Alpha) can sign in via the emailed PKCE verify link;
 *   2. she passes the permission gate on the seeded ALPHA document
 *      (/docs/40000000-…-0001): the page reaches the editor-initializing /
 *      collaboration-connect state — we deliberately do NOT assert a working
 *      editor, because no Hocuspocus server runs in this environment;
 *   3. she is denied the seeded BETA document (/docs/40000000-…-0002): the
 *      get_document_access RPC returns zero rows -> permission 'NONE' -> the
 *      NoPermission screen, with no leakage of the Beta document title
 *      (RLS hides it, so there is no existence oracle);
 *   4. POST /auth/signout revokes the session and protected /docs/* routes
 *      bounce back to /auth.
 *
 * Fixtures (supabase/seed.sql — deterministic and idempotent):
 *   alice.owner@nullfellows.dev  owner of Org Alpha, no role in Org Beta
 *   ALPHA doc 40000000-0000-4000-8000-000000000001 (Org Alpha)
 *   BETA  doc 40000000-0000-4000-8000-000000000002 (Org Beta)
 *
 * Environment contract:
 *   - `supabase start` stack running: API http://127.0.0.1:54321, Mailpit
 *     http://127.0.0.1:54324. CI runs `supabase db reset` before this suite to
 *     guarantee the fixtures; locally a reset is NOT required as long as the
 *     seed rows exist (the suite is read-only over the seeded tenant data).
 *   - The magic-link email embeds redirect_to for the requesting origin
 *     (http://localhost:3111). Local GoTrue accepts localhost redirect URLs on
 *     any port, so /auth/v1/verify 303s straight back into this app —
 *     empirically verified against the running stack.
 */

const ALICE_EMAIL = 'alice.owner@nullfellows.dev';
const ALPHA_DOC_ID = '40000000-0000-4000-8000-000000000001';
const BETA_DOC_ID = '40000000-0000-4000-8000-000000000002';

const SUPABASE_URL = 'http://127.0.0.1:54321';
const MAILPIT_URL = 'http://127.0.0.1:54324';

/* ------------------------------------------------------------------------- */
/* Mailpit helpers                                                           */
/* ------------------------------------------------------------------------- */

interface MailpitAddress {
  Name: string;
  Address: string;
}

interface MailpitListMessage {
  ID: string;
  To: MailpitAddress[] | null;
  Created: string;
}

interface MailpitMessageDetail {
  Text?: string;
  HTML?: string;
}

const VERIFY_LINK_RE = /https?:\/\/[^\s<>")]+\/auth\/v1\/verify\?[^\s<>")]+/;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function listMessages(): Promise<MailpitListMessage[]> {
  const res = await fetch(`${MAILPIT_URL}/api/v1/messages?limit=100`);

  if (!res.ok) {
    throw new Error(`Mailpit list failed: ${res.status} ${res.statusText}`);
  }

  const body = (await res.json()) as { messages: MailpitListMessage[] | null };

  return body.messages ?? [];
}

async function mailpitMessageIds(): Promise<Set<string>> {
  return new Set((await listMessages()).map((message) => message.ID));
}

function extractVerifyLink(source: string): string | null {
  return VERIFY_LINK_RE.exec(source)?.[0] ?? null;
}

/**
 * Polls Mailpit (newest-first list) for a message to `recipient` that was not
 * present in `previouslySeenIds`, then extracts the /auth/v1/verify PKCE link
 * from its body.
 */
async function waitForMagicLink(
  recipient: string,
  previouslySeenIds: Set<string>,
  timeoutMs = 30_000,
): Promise<string> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const fresh = (await listMessages()).find(
      (message) =>
        !previouslySeenIds.has(message.ID) &&
        (message.To ?? []).some((to) => to.Address.toLowerCase() === recipient.toLowerCase()),
    );

    if (fresh) {
      const res = await fetch(`${MAILPIT_URL}/api/v1/message/${fresh.ID}`);

      if (res.ok) {
        const detail = (await res.json()) as MailpitMessageDetail;
        const link =
          extractVerifyLink(detail.Text ?? '') ??
          extractVerifyLink((detail.HTML ?? '').replace(/&amp;/g, '&'));

        if (link) return link;
      }
    }

    await sleep(500);
  }

  throw new Error(
    `Timed out after ${timeoutMs}ms waiting for a magic-link email to ${recipient} in Mailpit (${MAILPIT_URL}).`,
  );
}

/* ------------------------------------------------------------------------- */
/* Stack preflight                                                           */
/* ------------------------------------------------------------------------- */

async function assertReachable(url: string, label: string): Promise<void> {
  try {
    const res = await fetch(url);

    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  } catch (error) {
    throw new Error(
      `${label} is not reachable at ${url} — start the local stack with \`supabase start\` ` +
        `(CI additionally runs \`supabase db reset\` for deterministic fixtures). Cause: ${String(error)}`,
    );
  }
}

test.beforeAll(async () => {
  await assertReachable(`${SUPABASE_URL}/auth/v1/health`, 'Supabase Auth (GoTrue)');
  await assertReachable(`${MAILPIT_URL}/api/v1/messages?limit=1`, 'Mailpit');
});

/* ------------------------------------------------------------------------- */
/* Flow helpers                                                              */
/* ------------------------------------------------------------------------- */

async function signInWithMagicLink(page: Page, email: string): Promise<void> {
  // Snapshot the mailbox BEFORE requesting the link so we only ever accept a
  // message generated by this run (Mailpit may hold mail from earlier runs).
  const previouslySeenIds = await mailpitMessageIds();

  await page.goto('/auth');
  await page.getByLabel('Email address').fill(email);
  await page.getByRole('button', { name: 'Send magic link' }).click();
  await expect(page.getByText('Check your inbox')).toBeVisible();

  const verifyLink = await waitForMagicLink(email, previouslySeenIds);

  // Following the PKCE verify link: GoTrue consumes the token and 303s to
  // /auth/callback?code=… on this app, which exchanges the code (using the
  // code-verifier cookie set by signInWithOtp) and redirects to `next`
  // (/dashboard by default). Landing on /dashboard — a proxy-protected route —
  // proves the session cookies are in place; a failed exchange would land on
  // /auth?error=auth_callback_failed instead.
  await page.goto(verifyLink);
  await expect(page).toHaveURL(/\/dashboard/);

  const cookies = await page.context().cookies();
  const hasSessionCookie = cookies.some(
    (cookie) => cookie.name.startsWith('sb-') && cookie.name.includes('auth-token'),
  );
  expect(hasSessionCookie, 'expected a Supabase auth session cookie after callback').toBe(true);
}

/* ------------------------------------------------------------------------- */
/* The journey                                                               */
/* ------------------------------------------------------------------------- */

test('alice signs in via magic link, opens the Alpha doc, is denied the Beta doc, and signout locks /docs', async ({
  page,
}) => {
  await test.step('sign in via magic link from Mailpit', async () => {
    await signInWithMagicLink(page, ALICE_EMAIL);
  });

  await test.step('ALPHA doc: permission gate passes (editor-initializing state)', async () => {
    await page.goto(`/docs/${ALPHA_DOC_ID}`);

    // Not bounced to /auth by the proxy — still on the document route.
    await expect(page).toHaveURL(new RegExp(`/docs/${ALPHA_DOC_ID}`));

    // The gate resolves get_document_access to EDIT for alice, so the page
    // proceeds past the permission check into the editor bootstrap. With no
    // Hocuspocus server running, it stays in the "initializing editor /
    // connecting to collaboration" loading state — that state IS the pass
    // signal; a working editor is out of scope here.
    await expect(page.getByText('正在初始化编辑器')).toBeVisible({ timeout: 60_000 });

    // And the NONE-permission screen is absent.
    await expect(page.getByText('无法访问文档')).toHaveCount(0);
  });

  await test.step('BETA doc: NONE permission -> NoPermission screen, no title leak', async () => {
    await page.goto(`/docs/${BETA_DOC_ID}`);

    // Authenticated, so the proxy lets the route render (no /auth bounce)…
    await expect(page).toHaveURL(new RegExp(`/docs/${BETA_DOC_ID}`));

    // …but get_document_access returns zero rows for a non-member, which the
    // gate maps to permission 'NONE' and renders the NoPermission screen
    // (app/docs/_components/NoPermission.tsx).
    await expect(page.getByRole('heading', { name: '无法访问文档' })).toBeVisible({
      timeout: 60_000,
    });
    await expect(page.getByText('您没有访问此文档的权限')).toBeVisible();

    // RLS hides the Beta document row entirely, so the screen must not leak
    // the document title (no cross-tenant existence oracle).
    await expect(page.getByText('Beta Welcome Document')).toHaveCount(0);
  });

  await test.step('signout revokes the session; /docs bounces to /auth', async () => {
    // POST-only signout route; page.request shares the browser cookie jar, so
    // the Set-Cookie clearing headers apply to the page context too. The 303
    // is followed to GET /auth (200).
    const signoutResponse = await page.request.post('/auth/signout');
    expect(signoutResponse.status()).toBe(200);
    expect(new URL(signoutResponse.url()).pathname).toBe('/auth');

    await page.goto(`/docs/${ALPHA_DOC_ID}`);

    // The proxy no longer finds a user and redirects to /auth, preserving the
    // attempted path in redirect_to.
    await expect(page).toHaveURL(/\/auth\?/);
    const bounced = new URL(page.url());
    expect(bounced.pathname).toBe('/auth');
    expect(bounced.searchParams.get('redirect_to')).toContain(ALPHA_DOC_ID);
  });
});
