# ADR 0001 — Retain DocFlow as the product foundation

- **Status**: Accepted (2026-07-18), contingent on Milestone 0 spike completing without a
  material blocker — see `docs/repository-selection.md` for the weighted revalidation.
- **Deciders**: build agent, per spec `docs/build-prompt.md` §2.

## Context

The product needs a production-grade collaborative web editor with rich-text blocks,
multi-result AI interaction patterns, and an active codebase under a permissive license.
The July 2026 audit shortlisted DocFlow (MIT, active, Tiptap 3 + Yjs + Next.js) against
Anansi, Wordcraft, Wordflow, Vellium, Novel, and others; none implements the full product.

Fresh findings at fork time (`32edc5f`):

1. The public tree is **frontend-only**. The NestJS/Prisma/Hocuspocus/MinIO/RabbitMQ backend
   the audit worried about does not exist here — the frontend calls an external
   `NEXT_PUBLIC_SERVER_URL`. The feared "adapt vs replace the heavy backend" dilemma is moot.
2. A clean checkout could not install: `tiptap-extension-export-docx@0.0.9` was unpublished
   from npm in 2026-02. The dependency was vestigial (zero import sites; implementation is
   vendored in-tree) and has been removed in this fork.
3. Editor assets we need are present and healthy: Tiptap 3 with `extension-unique-id`
   (stable block IDs), suggestion marks with accept/reject, collaboration caret, drag handle,
   and an AgentEditPanel flow (AgentIntent/AgentAnchor/AgentProposal) to evolve.

## Decision

Fork DocFlow (`javaxhaskell/intent-writing-studio`), keep the frontend monorepo as the
foundation, and build the missing server side on Supabase (ADR 0002). Anansi/Wordcraft/Loom
remain interaction references only (Loom: no license — no code reuse).

## Consequences

- We inherit a modern editor and collaboration client at near-zero porting cost.
- We own 100% of the backend surface; every endpoint the frontend expects must be
  inventoried and reimplemented, replaced, or removed (inventory in `docs/architecture.md`).
- Upstream divergence is permanent and deliberate; upstream merges become cherry-picks.
- The unpublished-package incident is recorded as a supply-chain lesson in `docs/security.md`.
