# CLAUDE.md — intent-writing-studio operating instructions

Product: collaborative AI writing studio with explorable writing pathways, a versioned
intent graph, block-level provenance, targeted regeneration, and frozen-model
personalization. Full spec: `docs/build-prompt.md`. Progress truth: `docs/build-state.md`.

## Session start (always)

1. Read `docs/build-state.md`; resume the first incomplete acceptance criterion.
2. `git status` + current branch + open PR state before any change.
3. Do not redo completed work unless verification shows it broken.

## Repo facts

- Turborepo pnpm monorepo; app is `apps/DocFlow` (Next.js App Router + Tiptap 3 + Yjs).
- Fork of xun082/DocFlow (MIT — preserve attribution). Upstream tree is frontend-only;
  we are building the backend on Supabase (ADR 0002).
- Node >= 24 (use `fnm exec --using=24 --`), pnpm 10.28.2 exactly.
- Upstream conventions (AGENTS.md): global components in `components/`; page-level in
  `app/[route]/_components/`; utilities in `utils/`; avoid useMemo/useCallback unless needed.
  Upstream's "no API routes" rule is superseded by ADR 0002 for server-side model calls
  and domain mutations — those live in App Router route handlers / server actions.

## Validation before completing any work

```bash
pnpm type-check          # required by upstream AGENTS.md
pnpm format:ci
pnpm lint                # NOTE: upstream lint script auto-fixes; review the diff it makes
pnpm test
pnpm build
```

Never run `pnpm dev` as a completion check (long-running).

## Non-negotiables (enforced in review — see .greptile/)

- One frozen foundation model per project (`LLM_MODEL` pinned; no fine-tuning). All provider
  calls behind the `ModelGateway` interface; no provider SDK imports in components/domain code.
- All model structured output Zod-validated before persistence or rendering. Never persist or
  display hidden chain-of-thought.
- Every public Supabase table: RLS enabled + negative tests. Service-role key server-only.
- Document blocks: stable UUIDs + intent/provenance links. Intent dependency edges acyclic.
- Regeneration: content-hash guarded; never overwrites concurrent collaborator edits; creates
  proposals + audit + preference events.
- Migrations: additive or with documented rollout/rollback; via `supabase/migrations/` only.
- Secrets: never in Git, logs, fixtures, or client bundles. `.env.example` stays harmless.

## Working style

- Small vertical slices; draft PR per slice; Greptile review loop until no actionable findings.
- Update `docs/build-state.md` at the end of every cycle — honestly.
- When context runs low: update the handoff section in `docs/build-state.md` first.
