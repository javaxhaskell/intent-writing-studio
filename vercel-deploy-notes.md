# Vercel deploy notes — intent-writing-studio (demo)

Quick reference for deploying the demo build of `apps/DocFlow` to Vercel.

## Project settings

- **Root Directory:** `apps/DocFlow`
  - Enable **"Include source files outside of the Root Directory"** (default on
    for monorepos) so the pnpm workspace at the repo root is visible.
- **Framework Preset:** Next.js (auto-detected).
- **Build Command:** default (`next build`). The app's own `build` script runs
  `next build --turbo`, which Vercel will use.

## Node version (engines caveat)

The root `package.json` pins `"engines": { "node": ">=24" }` with
`engineStrict: true`. In the Vercel project settings
(**Settings → General → Node.js Version**), select **24.x** — older runtimes
will fail the engines check at install time.

## Install command (pnpm monorepo)

The repo pins `"packageManager": "pnpm@10.28.2"`, so Vercel's corepack-based
install picks the right pnpm automatically. If the default install fails, set
the Install Command explicitly:

```
pnpm install --frozen-lockfile
```

Vercel runs it at the repository root (where `pnpm-workspace.yaml` and
`pnpm-lock.yaml` live) and builds only the `apps/DocFlow` workspace.

## Required environment variables

| Variable | Scope | Notes |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | client + server | Hosted Supabase project URL (`https://<ref>.supabase.co`) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | client + server | Hosted anon key (safe to expose; RLS enforces access) |
| `ANTHROPIC_API_KEY` | **server only** | Model calls in route handlers. Never expose with a `NEXT_PUBLIC_` prefix |
| `LLM_MODEL` | server | Frozen pinned model id (e.g. `claude-sonnet-5`) |
| `NEXT_PUBLIC_SITE_URL` | client + server | Canonical deploy URL, used for auth redirects (e.g. `https://demo.example.com`) |
| `NEXT_PUBLIC_DEMO_EMAIL` | client | Demo account email; defaults to `demo@nullfellows.dev` if unset |
| `NEXT_PUBLIC_DEMO_PASSWORD` | client | Demo account password; defaults to `intent-demo-2026` if unset. Deliberately public demo credential, not a secret |

Do **not** add `SUPABASE_SERVICE_ROLE_KEY` to the Vercel project — the app
never uses it. It is only needed locally when running the hosted seed script.

## Seeding the hosted demo data

Run once (and re-run freely; it is idempotent) from your machine, never from
the app:

```
SUPABASE_URL=https://<ref>.supabase.co \
SUPABASE_SERVICE_ROLE_KEY=<service-role-key> \
node scripts/seed-demo-hosted.mjs
```

It creates the confirmed demo auth user, the "Demo Workspace" org (owner
membership), "Demo Project", and the document "The Case for Legible AI
Writing", then prints the demo studio path:

```
/studio/33333333-3333-4333-8333-333333333333
```

Apply the migrations to the hosted project first
(`supabase db push` or the migration flow of your choice) so the tables exist.

## Auth configuration on hosted Supabase

- Add `https://<your-deploy>/auth/callback` to the Supabase Auth redirect
  allow-list (magic-link flow).
- The demo button uses password sign-in with the seeded account, so no email
  round-trip is needed for demo access.
