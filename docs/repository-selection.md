# Repository selection — July 2026 revalidation

Revalidated 2026-07-18 against live upstream trees during Milestone 0. Decision: **retain
DocFlow** (ADR 0001). This document records the evidence and the triggers that would reopen
the decision.

## Weighted matrix

Weights reflect spec priorities (§2). Scores 0–5 from direct source inspection.

| Criterion (weight) | DocFlow | Anansi | Wordcraft | Novel | Vellium |
|---|---|---|---|---|---|
| Product fit: multi-pathway + intent + provenance (×5) | 2 | 3 | 2 | 0 | 2 |
| Web architecture for collaborative SaaS (×4) | 5 | 1 | 1 | 3 | 0 |
| Rich block editing (Tiptap/PM) (×4) | 5 | 0 | 2 | 4 | 1 |
| Real-time collaboration (×4) | 4 | 0 | 0 | 0 | 0 |
| Supabase compatibility (×3) | 4 | 2 | 1 | 4 | 0 |
| Activity/maintenance (×2) | 4 | 2 | 0 | 3 | 3 |
| Tests (×2) | 0 | 1 | 2 | 1 | 1 |
| License (×3) | 5 (MIT) | 5 (MIT) | 5 (Apache-2) | 5 (Apache-2) | 5 (MIT) |
| Migration effort, inverse (×3) | 4 | 1 | 1 | 3 | 0 |
| **Weighted total (/150)** | **117** | **53** | **48** | **74** | **41** |

Loom: UX inspiration only — **no license, no code reuse** (restriction recorded here per spec).
Electric SQL collaborative-ai-editor: license file still absent at audit time — same restriction.
Wordflow: social prompt-engineering product, not a foundation candidate.

## Fresh evidence (fork base `32edc5f`, 2026-03-27)

Findings that changed the picture versus the pre-fork audit:

1. **The public DocFlow tree is frontend-only.** The audited NestJS/Prisma/Hocuspocus/MinIO/
   RabbitMQ backend is not in the repository; the frontend targets an external
   `NEXT_PUBLIC_SERVER_URL`. The spec's open question ("frontend clients exist for
   `/api/v1/chat/brainstorm` and `/api/v1/collaboration/agent/edit` but no server routes
   found") is resolved: those routes genuinely do not exist in the tree. The overlap-with-
   Supabase risk vanishes; the build-a-backend obligation appears. Net: favorable — no
   entrenched backend to fight, and the Supabase mandate has an empty slot to fill.
2. **Clean checkout did not install** (`tiptap-extension-export-docx@0.0.9` unpublished from
   npm 2026-02-16; zero import sites; vendored implementation in-tree). Fixed by removing the
   dependency. Recorded in `docs/upstream.md` and as a supply-chain lesson in `docs/security.md`.
3. **No test infrastructure exists** (`turbo run test` has no targets). Scored 0 above; the
   test pyramid is built from scratch per `docs/test-matrix.md`.
4. Editor assets needed for the product are present: Tiptap 3, `extension-unique-id`,
   suggestion marks with accept/reject, collaboration caret, AgentEditPanel
   (AgentIntent/AgentAnchor/AgentProposal), drag handle, slash commands.

## Foundation spike (Milestone 0, time-boxed)

Pass criteria and results — updated as the baseline completes:

- [x] Installable from clean checkout (after documented one-line fix)
- [x] Type-check passes at baseline (node v24.18.0, 2026-07-18)
- [x] Production build passes at baseline (`next build --turbo`)
- [x] Prettier + ESLint pass at baseline; `turbo run test` passes with **zero test targets**
      (no test infrastructure exists — building it is on us)
- [x] Editor/AI/collab insertion points identified without rewrite (subsystem mapping)
- [x] License clean (MIT at root, attribution preserved)

**Spike verdict: PASS.** DocFlow retained; no fallback triggered.

## Reopen triggers

The decision reverts to the user with evidence if any of these occur:

1. Baseline build cannot pass without disproportionate repair (> a few focused days).
2. A required editor capability (stable block attributes, mark-based diffs) proves
   incompatible with the vendored Tiptap 3 setup.
3. Yjs collaboration cannot be preserved alongside Supabase auth/state without forking
   Hocuspocus internals.
4. An upstream license change or credible IP claim surfaces.

Fallback path if reopened: clean Tiptap or Novel foundation + the same Supabase domain layer
(the domain schema and ModelGateway are foundation-agnostic by design).
