# Build state — single source of truth

> Update at the end of every meaningful work cycle. Do not describe intended
> future state as if it exists.

## Current position

- **Milestone**: 1 — Supabase foundation and secure tenancy (in progress). **Milestone 0: COMPLETE** — PR #1 merged 2026-07-18 17:47 UTC, CI green, Greptile round 2 clean (round-1 findings fixed: IR-2026-002 incident entry, max-warnings=0).
- **Branch**: `feat/m1-supabase-foundation`
- **PR**: not yet opened
- **Date**: 2026-07-18

## Credential preflight (2026-07-18) — PASSED

All values verified with read-only checks; stored in gitignored `.env.local`
(app) and `~/../.tooling-secrets.env` (tooling, outside repo). No values in Git.

| Credential | Status |
|---|---|
| GitHub (`javaxhaskell`, repo scope) | verified |
| Anthropic API key (`claude-sonnet-5` available; pinned) | verified |
| Supabase project `gfcmldfegjokpwoquray` (URL, anon, service-role, access token) | verified |
| Supabase DB password | present; live check at first `supabase link` |
| Greptile API key | verified; fork indexing triggered |
| Vercel token (`javaxhaskell`) | verified |

Note: one Management API response (`/postgrest` config) echoed the project JWT
secret into a local terminal. Local-only exposure; precautionary JWT-secret
rotation is queued for Milestone 6 hardening.

## Completed

- [x] Fork created (`javaxhaskell/intent-writing-studio`) at upstream `32edc5f`; `docs/upstream.md` written.
- [x] Repo layout inspected: frontend-only Turborepo (see upstream.md). AGENTS.md conventions noted.
- [x] Baseline defect found + fixed: `tiptap-extension-export-docx@0.0.9` unpublished from npm (2026-02-16), never imported in source → dependency removed, lockfile regenerated.
- [x] Greptile indexing of fork triggered; `.greptile/` config authored.
- [x] Node 24 installed via fnm (repo requires >=24; system default untouched).

- [x] **Baseline suite: ALL PASS** at `32edc5f` + dep fix (node v24.18.0): type-check, prettier check, eslint (no-fix), test (trivially — zero test targets exist), production build (`next build --turbo`). Foundation spike verdict: PASS.
- [x] Supabase CLI installed (brew).

- [x] Discovery workflow complete (9 agents): `docs/architecture.md` written — 69-endpoint backend inventory with dispositions, 10 ranked risks, first-slice recommendation.
- [x] Docs workflow complete: product-spec, data-model, security, test-matrix written + consistency pass (4 overclaims corrected).
- [x] CI hygiene: deleted upstream workflows (`preview.yml` contained a **committed plaintext Tiptap Pro token** and fired on every PR; `build.yml`/`deploy.yml` pushed Docker images and SSH-deployed to the upstream author's server; `lint.yml` used Node 20 vs required 24). Replaced with `.github/workflows/ci.yml` mirroring the verified baseline suite.
- [x] Env visibility fix: Next.js only loads env from the app dir — created gitignored `apps/DocFlow/.env.local` with Supabase/LLM vars plus localhost overrides so local dev never calls upstream's live infra (`api.codecrack.cn`, pinned by the git-tracked `.env.development`/`.env.production`).
- [x] Greptile: repo ENABLED for reviews in dashboard (user confirmed); indexing verified via API.

## Next actions

1. Open M1 slice-1 PR (schema + hygiene + DB CI) → Greptile loop → merge.
2. M1 slice 2 — auth bootstrap: Supabase Auth (magic link + GitHub), replace proxy.ts cookie gate and the /documents/:id/permissions dependency, session handling in the data layer.
3. M1 remainder: Supabase GitHub integration + preview branching (needs Pro plan check), two-org browser-level isolation verification (M1 done-criterion).

Done so far on this branch: supabase scaffolding + link; tenancy migration 20260718000001 + grants 20260718000002 with RLS enabled+forced; deterministic seed; **177/177 pgTAP tests pass locally** (db reset clean); generated DB types committed; env hygiene — all runtime coupling to upstream's live infra severed (env files, Sentry DSN/PII, SEO URLs, workflow websocket); CI gains a database job (migrations + pgTAP + types-drift).

## Open risks (full ranked list in docs/architecture.md)

- Git-tracked `apps/DocFlow/.env.development`/`.env.production` still point at upstream's live infra — neutralized locally via `.env.local` override; replacement lands in the M1 env-hygiene commit.
- Auth bootstrap hard-blocks editor feature work: `proxy.ts` cookie-gates `/docs`+`/dashboard`; `/docs/[room]` requires GET `/documents/:id/permissions` to succeed before constructing the Y.Doc.
- Data-layer contract coupling: `{code,message,data,timestamp}` envelope hard-checked at ~30 call sites; 401-refresh flow can double-execute non-idempotent generations.
- Yjs needs a websocket relay host (Vercel can't). Decision due by Milestone 3.
- Accept/reject in the current AgentSuggestion flow destroys block ids (deletes whole parent block) — must be reworked for provenance (Milestone 3/4).
- Upstream UI copy largely Chinese; localization planned, not started.
