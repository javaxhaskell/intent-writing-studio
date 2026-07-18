# Test matrix — requirements mapped to automated and manual tests

> Spec source: `docs/build-prompt.md` section 14 (test and quality strategy), section 13
> (milestones), section 19 (beta definition). Status truth: `docs/build-state.md`.
> Rule inherited from CLAUDE.md: never describe unbuilt coverage as existing. Every row
> below is **not yet implemented** — this document is the plan of record, updated as each
> layer lands.

## 1. Current state (verified 2026-07-18)

The fork has **no working test infrastructure**:

- Zero test files anywhere in `apps/` or `packages/` (no `*.test.*`, no `*.spec.*`).
- No `vitest.config.*`, no `playwright.config.*`, no test setup files.
- Root `pnpm test` runs `turbo run test`, but no workspace package defines a `test`
  script, so the command matches nothing and exits without executing tests.
- Upstream left dependencies declared but unwired: `vitest@^3.0.8` +
  `@vitest/coverage-v8` + `@vitest/ui` in `apps/DocFlow/package.json`, and
  `@playwright/test@^1.51.1` in the root `package.json`. Neither is configured or used.
- No `supabase/` directory exists yet, so no database, RLS, or migration tests can run.
- The only quality automation that currently executes: `tsc --noEmit`, ESLint (including
  `eslint-plugin-jsx-a11y` static accessibility rules), and Prettier check.

Consequence: test infrastructure is bootstrapped deliberately per milestone, starting in
Milestone 1. Versions above are the starting candidates; they will be re-pinned to
current stable at bootstrap time.

## 2. Planned test layers and tooling

| Layer | Planned tooling | First lands |
|---|---|---|
| Unit | Vitest (wired into `turbo run test`; per-package configs) | M1 (bootstrap), M2 (first domain suites) |
| Contract | Vitest + shared Zod schemas + deterministic fake-model fixtures (scripted `ModelGateway` implementation) | M2 |
| Database / RLS | pgTAP via `supabase test db` against local Supabase; supplemented by a Vitest harness issuing PostgREST/`supabase-js` calls with per-role JWTs for negative authorization | M1 |
| Integration | Vitest against local Supabase (`supabase start`) + fake `ModelGateway`; route handlers exercised directly | M2 |
| End-to-end | Playwright against `next dev`/`next start` + local Supabase, fake model selected by env var | M1 (auth), M3 (first product flows) |
| Collaboration | Playwright with two independent browser contexts + local Yjs relay (Hocuspocus) + fake-model regeneration in flight | M4 |
| Security | pgTAP negative tests + Vitest forged-JWT/PostgREST probes + adversarial prompt-injection fixtures + Playwright XSS probes + CI secret/bundle scanning (gitleaks or secretlint, built-client grep) + `pnpm audit` | M1, extended every milestone |
| Migration | CI jobs: `supabase db reset` from clean checkout on every PR; separate job applying new migrations onto the last released schema snapshot; `supabase gen types` diff check | M1 (clean), M6 (prior-schema formalized; first applicable after the first release) |
| Accessibility | `@axe-core/playwright` scans + Playwright keyboard-only scripts + `prefers-reduced-motion` emulation; `eslint-plugin-jsx-a11y` retained as the static layer | M3 (per-feature), M6 (full audit) |

A deterministic **fake model** is the backbone of contract, integration, E2E, and
collaboration layers: a scripted `ModelGateway` implementation returning fixture
pathways, drafts, streams, malformed outputs, injected failures, and adversarial
payloads. One opt-in, tagged live-provider smoke suite (pinned `anthropic` /
`claude-sonnet-5`) runs only when the API key and an explicit flag are present (M2).

## 3. Requirement-to-test matrix

All rows: **Status = not yet implemented.** The Milestone column states where the tests
land (spec section 13); suites are extended, not frozen, in later milestones.

### 3.1 Tenancy, auth, and RLS (spec 3.4, 10, M1)

| Requirement | Layer | Tooling | Status | Milestone |
|---|---|---|---|---|
| Every public table has RLS enabled (checked exhaustively, not per-table by hand) | Database/RLS | pgTAP query over `pg_tables`/`pg_policies` | Not yet implemented | M1 |
| Negative authorization: org A cannot read/insert/update/delete org B rows, for every sensitive table and operation | Database/RLS + security | pgTAP + Vitest PostgREST probes with two tenant JWTs | Not yet implemented | M1, extended each milestone as tables are added |
| Role matrix (owner / admin / editor / commenter-reviewer / viewer / unauthenticated — final role set per `data-model.md` §3) per operation | Database/RLS + integration | pgTAP role fixtures; Vitest + `supabase-js` per-role clients | Not yet implemented | M1 |
| Server-side mutations re-verify authorization (defense in depth beyond RLS) | Integration + security | Vitest route-handler tests with mismatched/forged JWTs | Not yet implemented | M1 |
| Magic-link sign-in and org-membership mapping | E2E | Playwright + local Supabase mail capture (Mailpit/Inbucket) | Not yet implemented | M1 |
| Service-role key absent from client bundles, logs, fixtures, Git | Security | CI scan of built `.next` client chunks + gitleaks/secretlint | Not yet implemented | M1 |
| Two test organizations isolated through browser, server, and direct API paths (M1 done-criterion) | E2E + security | Playwright two-org scenario + direct PostgREST calls | Not yet implemented | M1 |

### 3.2 Model gateway and structured-output contracts (spec 3.1, 4.3, M2)

| Requirement | Layer | Tooling | Status | Milestone |
|---|---|---|---|---|
| Every `ModelGateway` output validates against its Zod schema; malformed output is rejected or repaired, never persisted or rendered | Contract | Vitest + Zod + fake-model fixtures (valid, malformed, truncated) | Not yet implemented | M2 |
| Event streams (`DraftEvent`, `RegenerationEvent`): ordering, partial-stream handling, termination, cancellation via `AbortSignal` | Contract | Vitest with scripted async-iterable fake streams | Not yet implemented | M2 (draft), M4 (regeneration) |
| Retries, timeouts, rate limiting, idempotency, error categorization in the gateway | Unit | Vitest fake timers + failure-injecting fake model | Not yet implemented | M2 |
| Provider SDK calls confined behind the gateway (no imports in components/domain code) | Static/unit | ESLint `no-restricted-imports` + dependency check in CI | Not yet implemented | M2 |
| Hidden chain-of-thought / provider reasoning fields discarded — never persisted, never rendered | Contract + security | Fake-model fixtures containing reasoning fields; assert absence in DB rows and DOM | Not yet implemented | M2 (persistence), M3 (rendering) |
| Frozen-model pinning: `generation_runs` records provider, exact model id, prompt version, schema version; recorded model identifier never changes within a project | Unit + database | Vitest + pgTAP constraints | Not yet implemented | M2, re-asserted in M5 golden flow |
| Opt-in live-provider smoke test against pinned `claude-sonnet-5` | Contract (live) | Vitest tagged suite, gated on `ANTHROPIC_API_KEY` + explicit flag | Not yet implemented | M2 |

### 3.3 Pathway generation (spec 6, M2)

| Requirement | Layer | Tooling | Status | Milestone |
|---|---|---|---|---|
| Brief normalization produces schema-valid goals, audience, constraints, unknowns, evidence needs | Unit | Vitest + Zod | Not yet implemented | M2 |
| Pathway validation: all required fields present (`title` … `differenceFromOthers`, `preferenceMatchExplanation`); 3–5 pathways enforced | Unit + contract | Vitest + Zod fixtures | Not yet implemented | M2 |
| Duplicate detection: semantic (embedding similarity on fixture vectors) + structural heuristics; near-duplicates repaired or replaced | Unit | Vitest with deterministic fixture embeddings — no live embedding calls | Not yet implemented | M2 |
| Ranking respects explicit brief constraints; ranking may reorder but never hides viable pathways | Unit | Vitest | Not yet implemented | M2 (preference reranking added M5) |
| Selection and rejection captured as append-only preference events | Integration + database | Vitest + local Supabase; pgTAP append-only (UPDATE/DELETE rejected) | Not yet implemented | M2 |
| Brief → pathways survives refresh: durable job state, resumable progress | Integration + E2E | Vitest job-state tests; Playwright mid-generation reload | Not yet implemented | M2 |

### 3.4 Intent graph, provenance, and linked drafting (spec 3.2, 7, M3)

| Requirement | Layer | Tooling | Status | Milestone |
|---|---|---|---|---|
| Selected pathway converts to typed intent nodes, edges, and versions | Unit + integration | Vitest + fake model | Not yet implemented | M3 |
| Dependency subgraph stays acyclic: cycle rejection in domain validation and at the database | Unit + database | Vitest traversal cases; pgTAP test inserting a cycle and asserting rejection | Not yet implemented | M3 |
| Graph traversal: deterministic downstream resolution (diamond, deep chain, disconnected, multi-parent cases) | Unit | Vitest fixture graphs | Not yet implemented | M3 |
| Every generated block has stable UUID, primary intent link, pathway id, generation run id, provenance version, content hash | Integration + database | Vitest + pgTAP FK/NOT NULL/unique constraints | Not yet implemented | M3 |
| Content hash deterministic over canonical block content (guard input for M4) | Unit | Vitest | Not yet implemented | M3 |
| Tiptap provenance attributes survive editing; copied plain text and default exports exclude provenance | Unit (editor) + E2E | Vitest + ProseMirror/jsdom; Playwright clipboard/export check | Not yet implemented | M3 |
| Intent versions immutable; edits create versions, history never destroyed | Database | pgTAP UPDATE/DELETE rejection | Not yet implemented | M3 |
| Intent Lens shows accurate purpose, dependencies, pathway provenance, constraints, freshness, lock state, last event for the clicked block | Integration + E2E | Playwright over fake-model-seeded document | Not yet implemented | M3 |
| Lens language is explicit product language — no hidden-model-thought claims, no reasoning fields in DOM | Security + E2E | Playwright DOM assertions against reasoning-bearing fixtures | Not yet implemented | M3 |

### 3.5 Impact analysis and targeted regeneration (spec 8, M4)

| Requirement | Layer | Tooling | Status | Milestone |
|---|---|---|---|---|
| Impact analysis is deterministic and model-free: intent edit → exact affected block set with reasons | Unit | Vitest graph + link fixtures | Not yet implemented | M4 |
| Locked blocks excluded from regeneration; resulting consistency risk reported | Unit + E2E | Vitest; Playwright (golden-flow steps 7–9) | Not yet implemented | M4 |
| Stale marking is transactional; no partial stale states | Integration | Vitest + local Supabase | Not yet implemented | M4 |
| Regeneration jobs idempotent: duplicate enqueue with same key yields one job; retry safe; attempt counts and dead-letter behavior correct | Unit + integration | Vitest; duplicate-enqueue tests against local queues | Not yet implemented | M4 |
| Conflict detection: original-hash mismatch → proposal marked conflicted, concurrent collaborator edit never overwritten | Unit + integration + collaboration | Vitest; two-client Playwright + Yjs scenario | Not yet implemented | M4 |
| Accepted proposals applied through ProseMirror/Yjs transactions; all collaborators converge | Collaboration | Playwright two contexts, assert converged Yjs state | Not yet implemented | M4 |
| Accept/reject per block, per section, and batch; each decision creates audit + preference events | Integration + database + E2E | Vitest; pgTAP; Playwright (steps 10–14) | Not yet implemented | M4 |
| Cancellation and partial failure: cancel mid-stream leaves consistent state; typed content never lost | Unit + integration + E2E | Vitest `AbortSignal` tests; Playwright failure injection | Not yet implemented | M4 |

### 3.6 Collaboration (spec 3.5, M4 and M6)

| Requirement | Layer | Tooling | Status | Milestone |
|---|---|---|---|---|
| Two clients editing while a regeneration is in flight: no lost keystrokes, conflicted proposal flagged (spec 14 required scenario) | Collaboration | Playwright two browser contexts + local Hocuspocus relay + fake model with controllable latency | Not yet implemented | M4 |
| Broadcast job progress reaches all clients; Presence reflects active-document state | Integration | Vitest + local Supabase Realtime | Not yet implemented | M4 |
| Multi-user verification under role permissions (viewer cannot mutate, etc.) | Collaboration + security | Playwright multi-role sessions | Not yet implemented | M6 |
| Realtime volume stays within budget (no token-by-token broadcast) | Integration | Vitest message-count assertions on generation runs | Not yet implemented | M6 |

### 3.7 Frozen-model personalization / preference memory (spec 9, M5)

| Requirement | Layer | Tooling | Status | Milestone |
|---|---|---|---|---|
| Preference aggregation: one isolated action never becomes a permanent preference; repeated-evidence thresholds and confidence scoring | Unit | Vitest event-sequence fixtures | Not yet implemented | M5 |
| Explicit task instructions outrank inferred memory; scope precedence (user / org / project / document type / audience) and conflict resolution | Unit | Vitest | Not yet implemented | M5 |
| Prompt assembly: compact preference context, hard token budget, versioned prompts, injection-resistant composition | Unit | Vitest snapshot + budget assertions | Not yet implemented | M5 |
| pgvector retrieval is RLS-scoped: tenant A never retrieves tenant B memories through any retrieval function | Database/RLS + security | pgTAP + Vitest two-tenant retrieval probes | Not yet implemented | M5 |
| Deletion propagation: reset/disable/delete removes retrievability immediately | Integration | Vitest + local Supabase | Not yet implemented | M5 |
| Reranking measurably affects ordering without hiding pathways; `preferenceMatchExplanation` labelled application-generated | Unit + E2E | Vitest; Playwright (golden-flow steps 15–16) | Not yet implemented | M5 |
| Memory controls: inspect, edit, disable, export, reset — each verified end to end | E2E | Playwright | Not yet implemented | M5 |
| Embeddings pipeline durable: queue + retry, single documented embedding model/dimension, no cross-model vector comparison | Integration + unit | Vitest + local Supabase queues | Not yet implemented | M5 |

### 3.8 Security (spec 3.4, 9, 14 — cross-cutting)

| Requirement | Layer | Tooling | Status | Milestone |
|---|---|---|---|---|
| Cross-tenant access attempts via browser, server routes, and direct PostgREST | Security + database | pgTAP + Vitest probes | Not yet implemented | M1, extended every milestone |
| Privilege escalation: role tampering, JWT forgery, self-promotion attempts | Security | Vitest forged-JWT suite | Not yet implemented | M1, hardened M6 |
| Malicious source content and stored prompt injection: adversarial fixtures in source materials (M2) and preference memories (M5) must not alter system behavior, leak prompts, or exfiltrate data | Security + contract | Adversarial fixtures + fake-model transcript assertions; Playwright rendered-output checks | Not yet implemented | M2 (sources), M5 (memories) |
| Unsafe rendered output: model-returned HTML/markdown sanitized; XSS payload fixtures render inert everywhere model text appears | Security + E2E | Vitest DOM sanitization tests; Playwright XSS probes | Not yet implemented | M3 |
| No secrets in diff, built client, logs, or fixtures | Security (static) | gitleaks/secretlint + built-bundle scan in CI | Not yet implemented | M1 |
| Dependency audit: no unaddressed critical vulnerabilities | Security (static) | `pnpm audit` in CI | Not yet implemented | M1 |
| Rate limits and abuse controls enforced | Security + integration | Vitest burst tests against route handlers | Not yet implemented | M6 |

### 3.9 Migrations and schema (spec 10, M1 onward)

| Requirement | Layer | Tooling | Status | Milestone |
|---|---|---|---|---|
| Clean-database migration: full `supabase db reset` + seed succeeds from a clean checkout on every PR | Migration | Supabase CLI in CI | Not yet implemented | M1 |
| Upgrade from the prior released schema: new migrations apply onto a snapshot of the last released schema, followed by smoke queries | Migration | CI job with schema snapshot artifact | Not yet implemented | M6 (formalized; first applicable after the first released schema) |
| Generated database types synchronized with schema | Migration (static) | CI diff of `supabase gen types` vs committed types | Not yet implemented | M1 |
| Constraints, functions, and triggers behave as specified (append-only tables, immutability, cycle rejection, hash guards) | Database | pgTAP | Not yet implemented | M1, extended with each schema addition |

### 3.10 Accessibility and UX states (spec 14, 15, M3–M6)

| Requirement | Layer | Tooling | Status | Milestone |
|---|---|---|---|---|
| Keyboard-only operation of pathway comparison/selection, intent outline, Intent Lens, impact preview, diff accept/reject | Accessibility (E2E) | Playwright keyboard-only scripts | Not yet implemented | M3–M4 per feature, full audit M6 |
| Focus management: lens/dialog open, close, and return focus | Accessibility | Playwright + `@axe-core/playwright` | Not yet implemented | M3 |
| Labels and contrast on all key screens | Accessibility | `@axe-core/playwright` scans; `eslint-plugin-jsx-a11y` static layer (already configured) | Not yet implemented (scans) | M6 |
| Reduced motion respected | Accessibility | Playwright `prefers-reduced-motion` emulation | Not yet implemented | M6 |
| Loading, empty, partial, cancelled, failed, and retry states for every generation surface; streams cancellable; typed content never lost on failure | E2E + integration | Playwright with failure-injecting fake model | Not yet implemented | M2–M4 per feature |

## 4. Golden user acceptance flow (canonical E2E scenario)

Reproduced verbatim from `docs/build-prompt.md` section 14. This is the single canonical
acceptance scenario; it will live as one Playwright spec (working name
`e2e/golden-flow.spec.ts`) driven end to end by the deterministic fake model.

> Automate as much of this as possible:
>
> 1. User signs in and creates a workspace.
> 2. User submits a brief.
> 3. System returns at least three distinct pathways using a fake model fixture.
> 4. User compares and selects a pathway.
> 5. System creates an intent graph and draft.
> 6. User clicks a paragraph and sees accurate intent.
> 7. User locks one paragraph.
> 8. User edits a parent intent.
> 9. System previews affected paragraphs and excludes the locked paragraph.
> 10. User approves regeneration.
> 11. A collaborator edits one affected paragraph before generation completes.
> 12. System flags that proposal as conflicted instead of overwriting it.
> 13. User accepts another proposal and rejects one.
> 14. Events are recorded.
> 15. On a later document, relevant preferences influence pathway ranking.
> 16. User resets the inferred preference and the effect disappears.

Planned rollout of the spec (all steps not yet implemented):

| Steps | Becomes runnable | Notes |
|---|---|---|
| 1 | M1 | Auth + workspace creation |
| 2–4 | M2 | Fake-model pathway fixtures; distinctness asserted |
| 5–6 | M3 | Intent graph, draft, Intent Lens accuracy |
| 7–14 | M4 | Locking, impact preview, conflicted proposal via second browser context, accept/reject, event assertions against the database |
| 15–16 | M5 | Second-document ranking shift and preference reset |

From M5 onward the full 16-step spec is a required check on every PR touching a critical
path; in M6 it must also pass against the staging environment (beta acceptance).

## 5. PR readiness gate (spec section 14 required checks)

Planned CI enforcement for every PR, mapped to jobs. None of these CI jobs exist yet.

| Required check | Planned CI job | Milestone |
|---|---|---|
| Install succeeds from clean checkout | `pnpm install --frozen-lockfile` | M1 |
| Formatting / linting / type-checking | `pnpm format:ci`, `pnpm lint` (no-fix variant to be added — upstream `lint` auto-fixes), `pnpm type-check` | M1 |
| Unit + integration tests | `pnpm test` (Vitest wired into turbo) | M1–M2 |
| Database and RLS tests | `supabase test db` (pgTAP) + Vitest RLS harness | M1 |
| E2E for changed critical paths | Playwright, fake model | M3 |
| Production build | `pnpm build` | M1 |
| No secrets in diff or built client | gitleaks/secretlint + bundle scan | M1 |
| Dependency audit | `pnpm audit` gate | M1 |
| Supabase preview branch healthy + preview smoke test | branch status check + Playwright smoke against preview | M1–M2 |
| Greptile: no unresolved actionable findings | Greptile review loop (process gate, not CI) | M0 onward |
| Docs/screenshots match implementation | PR template + review checklist (manual) | M0 onward |

## 6. Maintenance rules

- Every PR that adds behavior must update this matrix in the same PR: flip rows it
  implements from "Not yet implemented" to a link to the test files, and add rows for
  any new requirement.
- A row may only be marked implemented when the test runs in CI and fails on reverted
  behavior — not when a file merely exists.
- Manual-only coverage (screenshots, exploratory passes) is recorded per milestone in
  `docs/build-state.md`, not silently assumed here.
