# ADR 0003 — One frozen foundation model per project, behind a ModelGateway

- **Status**: Accepted (2026-07-18)

## Context

The product promise is application-level adaptation around an unchanged model (spec §3.1, §9):
no fine-tuning, no adapters, reproducible generations, provider-agnostic domain code.

## Decision

- Initial pin: `LLM_PROVIDER=anthropic`, `LLM_MODEL=claude-sonnet-5` (verified available on
  the project key, 2026-07-18). The pin lives in env + per-project settings; changing it is
  an explicit user action recorded in the project, never an automatic upgrade.
- All model access goes through a typed `ModelGateway` interface
  (`generatePathways`, `generateDraft`, `explainBlock`, `regenerateBlocks`) in a shared
  domain package. Components and domain logic never import provider SDKs.
- Every generation persists: provider, exact model id, prompt version, structured-output
  schema version, parameters, usage, latency, status, and correlation id (`generation_runs`).
- All structured outputs are Zod-validated; retries/timeouts/cancellation/rate limiting and
  error categories are gateway concerns; provider secrets never reach the browser.
- Provider private-reasoning fields are discarded at the gateway. User-facing explanations
  come only from explicit schema fields; nothing labeled as model "thinking" is stored,
  streamed, or rendered. (The upstream AgentEditPanel currently displays thinking output —
  removing that is in scope for the pathway/agent rework, Milestone 2+.)
- Embeddings are a separate, also-pinned choice: Supabase built-in `gte-small` (384-dim)
  by default; vectors from different models are never compared (enforced by storing the
  embedding model + dimension alongside each vector and rejecting mismatches).

## Consequences

- Provider migration cost is confined to one adapter implementation + config.
- Reproducibility and audit are database-backed, satisfying the Intent Lens history view.
- A deterministic fake-model gateway implementation becomes the test backbone
  (contract tests + E2E fixtures) — no live-provider dependency in CI.
