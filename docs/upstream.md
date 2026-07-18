# Upstream record

| | |
|---|---|
| Upstream | https://github.com/xun082/DocFlow |
| License | MIT (preserved in `LICENSE.md`; attribution retained) |
| Fork | https://github.com/javaxhaskell/intent-writing-studio |
| Base SHA | `32edc5f0507c4fec78a479d3dd18737f33c1d284` |
| Base commit date | 2026-03-27 (`feat(docflow): replace ChatPanel with AgentEditPanel and agent suggestion flow (#327)`) |
| Fork created | 2026-07-18 |

## What the upstream tree contains (verified 2026-07-18)

The public DocFlow repository is **frontend-only**: a Turborepo pnpm monorepo with one Next.js
app (`apps/DocFlow`, Tiptap 3 + Yjs + `@hocuspocus/provider`) and three utility packages
(`packages/alert`, `packages/bilibili`, `packages/transformer`). The NestJS/Prisma/Hocuspocus
backend referenced by the frontend (`NEXT_PUBLIC_SERVER_URL`, `NEXT_PUBLIC_WEBSOCKET_URL`,
`NEXT_PUBLIC_NOTIFICATION_WEBSOCKET_URL`) is **not published** in this tree. Upstream's
`AGENTS.md` confirms the convention: "App Router for routing only; no API routes".

Consequence: all server behavior (auth, documents, AI generation, collaboration relay) must be
built in this fork. See `docs/decisions/0002-supabase-as-backend.md`.

## Known upstream defects at base SHA

1. **Install fails from a clean checkout**: `apps/DocFlow/package.json` pinned
   `tiptap-extension-export-docx@^0.0.9`, but that package was unpublished from the public npm
   registry on 2026-02-16 (`ERR_PNPM_FETCH_404`). The dependency is never imported in source —
   the app vendors its own implementation under `apps/DocFlow/src/utils/export-doc/` — so the
   fix applied in this fork is removal of the dead dependency. (npmmirror still serves the
   tarball, which is presumably how upstream CI continues to pass in China.)

## Update strategy

- `upstream` remote is configured. We do not track upstream `main` automatically.
- Cherry-pick upstream fixes case-by-case; product architecture diverges deliberately
  (Supabase backend, pathway/intent/provenance domain).
- Re-evaluate a merge from upstream only before Milestone 6 hardening, and only if it carries
  editor/security fixes we need.
