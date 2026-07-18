# Product specification — Intent Writing Studio

> Status: planning document, written during Milestone 0. Nothing in this spec is
> implemented unless `docs/build-state.md` says so. All requirements below are
> written as future behavior and acceptance criteria. Source of authority:
> `docs/build-prompt.md` (full build prompt); verified repository facts:
> `docs/upstream.md` and `CLAUDE.md`.

## 1. Product outcome and core promise

Intent Writing Studio will be a collaborative, web-based AI writing workspace
that exposes and preserves the decisions that shape a draft. Instead of
producing one opaque draft, the application will generate several meaningfully
different writing *pathways*, let the user choose or combine them, convert the
choice into a persistent, versioned *intent graph*, and generate a draft whose
blocks are causally linked to nodes in that graph. Editing an intention shows
exactly which blocks would change — and why — before anything is regenerated.

The core promise is **control and legibility**:

- **Control**: the user approves every consequential rewrite. Accepted content
  is never overwritten automatically; locked blocks stay untouched; regeneration
  produces reviewable proposals with diffs, not silent replacements.
- **Legibility**: the user can always answer "why does this section exist?" and
  "what will change if I alter this decision?" through explicit, user-facing
  product data (purpose, dependencies, assumptions, trade-offs, provenance) —
  never through claimed access to hidden model reasoning.

The application will adapt to a user or team over time through application-level
preference memory. One foundation model is pinned per project — initially
Anthropic `claude-sonnet-5` — and is never fine-tuned, trained, or modified.
Personalization happens entirely around the model: in event capture, memory
retrieval, prompt context, and candidate reranking.

Technical foundation (verified): the repository is a frontend-only fork of
DocFlow (Next.js App Router, Tiptap 3 + Yjs editor). All server behavior —
auth, persistence, AI generation, job state — will be built on Supabase
(Postgres + RLS, Auth, Realtime, Storage, pgvector, queues) plus App Router
route handlers / server actions for model calls, per ADR 0002.

## 2. Core user journey

The complete journey the product must eventually support:

1. A user creates a workspace, project, and document.
2. The user supplies a brief, source material, audience, goal, constraints, and
   optional examples.
3. The application uses one configured, frozen foundation model to generate
   three to five genuinely different pathways.
4. Each pathway explains its thesis, structure, audience strategy, tone,
   assumptions, trade-offs, evidence needs, and proposed ending in concise
   user-facing language.
5. The user compares pathways, selects one, or deliberately combines elements
   from several.
6. The application turns the selected pathway into a structured intent graph.
7. The application generates a draft whose document blocks are causally linked
   to nodes in that graph.
8. Clicking a paragraph or section opens an Intent Lens showing its purpose,
   dependencies, pathway provenance, constraints, tone, status, and generation
   history.
9. Editing an intent node produces an impact preview identifying the blocks
   that would become stale.
10. With user approval, the application regenerates only the affected, unlocked
    blocks and presents a diff for acceptance or rejection.
11. The application records selections, rejections, edits, accepted
    suggestions, regenerations, locks, and explicit preferences.
12. Future pathway ranking and prompt context adapt to those preferences while
    the foundation model remains unchanged.
13. Users can inspect, edit, disable, export, and reset the preference memory
    that affects them.

## 3. Functional requirements

### 3.1 Brief intake

- The brief form will capture: goal, audience, constraints, source materials
  (uploaded to Supabase Storage), and optional approved examples.
- The pipeline will normalize the brief into explicit goals, audience,
  constraints, inputs, unknowns, and required evidence before any pathway
  generation. The normalized brief is persisted and shown to the user.
- Source materials and examples are treated as untrusted input: stored content
  must not be able to inject instructions into generation prompts (tested).
- A brief must be resumable: closing the browser after submission must not lose
  the brief or any in-flight generation (durable job state in Supabase).
- Absence of optional fields (examples, source material) must not block
  generation; missing required fields produce clear inline validation.

### 3.2 Pathway generation

- From one brief, the application will generate **three to five** pathways
  using the project's single pinned model.
- **Distinctness is a hard requirement**: pathways must differ in strategy, not
  wording. The same outline paraphrased does not satisfy it. The pipeline will:
  1. Select distinct strategy axes appropriate to the task (e.g. narrative vs
     analytical, problem-first vs vision-first, chronological vs thematic,
     cautious vs provocative, executive vs practitioner, evidence-led vs
     story-led).
  2. Generate pathways along those axes with the pinned model.
  3. Validate every pathway against a structured schema (Zod) before
     persistence or rendering.
  4. Detect semantic near-duplicates using embeddings plus structural
     heuristics, then repair or replace them.
  5. Rank pathways using explicit brief constraints and retrieved, tenant-
     authorized preferences.
- **Required fields per pathway** (schema-validated):
  `title`, `oneSentenceApproach`, `thesis`, `audienceStrategy`, `tone`,
  `structure[]`, `keyDecisions[]`, `assumptions[]`, `tradeoffs[]`,
  `evidenceNeeded[]`, `endingStrategy`, `differenceFromOthers`, and
  `preferenceMatchExplanation` (clearly labelled as an application-generated
  explanation, not a model self-report).
- **Fair display**: preference ranking may affect ordering but must never hide
  a viable pathway. All valid alternatives remain visible and comparable.
- Every pathway set, including rejected alternatives, is persisted
  (`pathway_sets`, `pathways`) with the generation run record (provider, model
  id, prompt version, schema version, usage, latency, correlation id).
- Selection and rejection are captured as preference/learning events.

### 3.3 Pathway selection and blending

- Selection ships first. A user selects one pathway; the choice, and the
  implicit rejection of the others, become recorded events.
- Blending ships only after selection is stable and tested. Blending will let a
  user deliberately combine elements from several pathways (e.g. the structure
  of one with the tone and ending of another) via normalized
  `pathway_components`.
- A blended pathway is a **new derived pathway** with explicit provenance links
  back to each source component — never an untraceable merge.
- Comparison view: pathways are presented as cards with a side-by-side
  comparison surface; users can compare before committing.

### 3.4 Intent graph and Intent Lens

**Intent graph.** When a pathway is selected, the application will convert it
into a versioned graph of typed intent nodes and directed edges:

- Node types: brief, thesis, section goal, paragraph goal, audience, tone,
  constraint, evidence, objection, transition, ending.
- Edge types: `derives_from`, `depends_on`, `supports`, `contrasts_with`,
  `satisfies`, `constrains`.
- Intent edits never destroy history: every change creates an immutable
  `intent_versions` record.
- The dependency portion of the graph must remain acyclic, enforced by domain
  validation plus database safeguards, with cycle rejection tested.
- The primary rendering is an **accessible outline-first view**. A graph canvas
  may be added later as a progressive enhancement; the product must be fully
  usable without ever manipulating a canvas.

**Block provenance.** Draft generation proceeds in dependency order and every
generated block carries, via a Tiptap extension: a stable block UUID
(independent of editor position), pathway id, intent node ids (one primary
link, zero or more supporting), generation run id, provenance version, lock
state, freshness state (current / stale / regenerating / proposed / accepted /
rejected / manually edited), and a content hash for concurrency protection.
Provenance attributes stay out of copied plain text and normal exports unless
the user requests an audit export.

**Intent Lens.** Focusing or clicking a generated block opens the Intent Lens,
which will show:

- Purpose of this block.
- Primary and supporting intentions.
- Dependencies and downstream effects.
- Pathway of origin.
- Audience and tone constraints.
- Evidence requirements.
- Assumptions and trade-offs.
- Freshness and lock state.
- Last generation or manual-edit event.
- A safe, concise explanation of why the block exists.

The Lens must use explicit product language — "document intention", "writing
decision", "purpose", "dependency" — and must never claim to reveal hidden
model thoughts. Hidden chain-of-thought is neither stored nor displayed; the
upstream agent UI behavior of streaming model "thinking" fields will be removed
and replaced with these explicit fields.

### 3.5 Impact preview and targeted regeneration

Impact analysis is deterministic and runs **before** any model call. When a
user edits an intent node:

1. A new intent version is created; history is preserved.
2. The application traverses downstream dependency edges.
3. Affected document blocks are resolved from block–intent links.
4. Locked blocks are excluded; any resulting consistency risk is reported.
5. Affected blocks are marked stale in a single transaction.
6. An **impact preview** shows which blocks would change and why.
7. Nothing regenerates until the user approves.
8. On approval, an idempotent, cancellable regeneration job is created.
9. The smallest coherent block set is regenerated, using unchanged surrounding
   content as constraints.
10. Each proposal is compared against the original block hash and current
    document state before applying.
11. If a collaborator edited a block while generation was in flight, that
    proposal is marked **conflicted** and offered for review — it never
    overwrites the newer edit.
12. Proposals are presented as inline or side-by-side diffs, acceptable or
    rejectable per block, per section, or as a batch.
13. Accepted proposals apply through normal ProseMirror/Yjs transactions so
    collaborators receive valid updates.
14. Every acceptance, rejection, and manual adjustment creates preference and
    audit events.

Locked blocks remain unchanged unless the user explicitly unlocks them. Graph
traversal, locked-node boundaries, cycles, stale hashes, concurrent edits,
partial failures, cancellation, retry, and idempotency are all unit-tested.

### 3.6 Preference memory (frozen-model personalization)

Product name: "preference memory" / application-level adaptation. The product
must never imply the foundation model has been trained on the user.

**Capture.** The application records behavioral events with context: pathway
selections, rejections, and merges; intent edits; accepted and rejected
proposals; manual edits; locks and unlocks; explicit ratings; and resets — as
append-only `preference_events`.

**Explicit vs inferred.** Explicit preferences (stated by the user) are kept
separate from inferred ones. A single isolated action is never promoted to a
permanent preference: promotion requires repeated evidence or explicit user
confirmation, with confidence and evidence counts tracked. Inferred
preferences are always visible and reversible.

**Scopes and precedence.** Preferences carry explicit scope: user,
organization, project, document type, and audience. Precedence and conflict
resolution between scopes must be defined and documented; one rule is fixed
now: **explicit user instructions for the current task always outrank inferred
memory**.

**Retrieval and use.** Approved examples and summarized patterns are embedded
with pgvector and retrieved only when relevant and tenant-authorized (RLS-
compatible retrieval functions). A compact preference context is added to
pathway-generation requests; candidates are reranked by preference
compatibility and task fit; the ranking rationale is explained to the user.
Preference kinds include: tone and voice, structure and pacing, level of
detail, evidence style, audience assumptions, terminology, repeatedly approved
examples, repeatedly rejected patterns, and team rules / brand constraints.

**User controls.** For all memory affecting them, users will be able to:

- **Inspect** — see every profile entry and memory, its scope, confidence,
  provenance, and the evidence behind it.
- **Edit** — correct or refine any entry.
- **Disable** — turn off a specific memory, or memory influence entirely,
  without deleting history.
- **Export** — take memory out of the product in a documented format.
- **Reset** — delete inferred memory and verify its effect disappears (part of
  the golden acceptance flow); deletion propagates so revoked memories cannot
  be retrieved.

**Defenses** (all tested): cross-tenant retrieval, prompt injection inside
stored source materials or examples, overfitting after one action, preference
drift, stale or contradictory memories, excessive prompt growth, and storing
sensitive information without user visibility.

### 3.7 Collaboration expectations

- Multi-user editing continues through Yjs/CRDT (the upstream editor's existing
  CRDT path). Yjs is not replaced with raw database subscriptions. Note: the
  upstream Hocuspocus websocket backend is not in the tree; the collaboration
  relay decision is open (see build-state risks) and due by Milestone 3.
- Supabase holds durable domain state, auth, permissions, job state, and audit
  events. Supabase Presence carries slow-changing state (online status, active
  document); Broadcast carries generation-job progress and application events —
  never token-by-token or per-keystroke traffic.
- Regeneration is concurrency-safe: version and content-hash guards ensure a
  proposal can never overwrite a collaborator's newer edit (conflicted-proposal
  path, tested with two clients editing while a regeneration is in flight).
- Role-based permissions (target set: owner, editor, commenter/reviewer,
  viewer) are enforced in Postgres RLS — not only in UI or server handlers —
  with negative authorization tests for every sensitive operation.
- Organizations/workspaces are the tenancy boundary; two organizations must not
  be able to access each other's data through browser, server, or direct API
  paths.

## 4. UX requirements

The experience should feel like steering a piece of writing, not operating a
developer graph tool.

- Start with pathway cards and an outline; introduce graph visualization
  progressively, never as a prerequisite.
- Use plain language for intent, dependencies, and impact.
- Keep the main editor calm and uncluttered.
- Make provenance available on demand through the Intent Lens, not ambiently.
- Show exactly what will change before regeneration.
- Make locked content visually clear without dominating the page.
- Preserve undo and redo semantics.
- Provide loading, empty, partial, cancelled, failed, and retry states for all
  asynchronous operations.
- Keep streams cancellable.
- Never lose typed content when a request fails.
- Make preference memory visible and understandable.
- No anthropomorphic claims ("the model knows you"); say the application has
  learned or saved preferences.
- All essential operations keyboard accessible; accessibility checks cover
  focus management, labels, contrast, and reduced motion.

## 5. Acceptance criteria by milestone

Sequencing may adjust after discovery, but these outcome boundaries hold.

### Milestone 0 — Discovery and executable baseline

Deliverables: fork + upstream record; redacted credential preflight; time-boxed
foundation spike and weighted repository revalidation; architecture map of the
current codebase; baseline install/test/type-check/build report; existing AI
and collaboration flow map; Supabase migration plan; threat model; this product
spec and the test matrix; Greptile configuration; first ADRs.

**Done when** a new engineer can understand the current system, target system,
risks, and next vertical slice from repository documentation alone.

### Milestone 1 — Supabase foundation and secure tenancy

Deliverables: Supabase local development; GitHub-linked preview branching; auth
integration; organizations, memberships, projects, documents; RLS policies with
negative tests; generated database types; seed data; CI migration checks; the
existing editor still works.

**Done when** two test organizations cannot access each other's data through
browser, server, or direct API paths.

### Milestone 2 — Multiple pathways

Deliverables: model gateway; structured brief normalization; three-to-five
distinct pathway generation; streaming or durable job progress; pathway cards
and comparison view; duplicate detection and repair; selection/rejection event
capture; mock-model tests plus one opt-in live-provider smoke test.

**Done when** a user can submit a brief, compare meaningfully different valid
pathways, select one, and resume after refresh without data loss.

### Milestone 3 — Intent graph and linked drafting

Deliverables: intent nodes, edges, versions; selected-pathway conversion;
stable Tiptap block IDs and provenance attributes; draft generation linked to
intent; accessible intent outline; Intent Lens; provenance history.

**Done when** every generated block can be traced to valid intent and pathway
records, and clicking it shows an accurate user-facing explanation.

### Milestone 4 — Targeted regeneration

Deliverables: intent editing; deterministic impact analysis; locked blocks;
stale-state visualization; regeneration jobs; conflict-safe proposals; block
and batch diffs; accept/reject workflow; concurrency, cancellation, retry, and
idempotency tests.

**Done when** changing one intent regenerates only the correct unlocked blocks,
preserves unrelated content, and cannot overwrite a collaborator's newer edit.

### Milestone 5 — Frozen-model personalization

Deliverables: preference event pipeline; explicit and inferred profiles;
pgvector memory retrieval with RLS; evidence thresholds and confidence;
pathway reranking; preference explanations; user controls to edit, disable,
export, and reset memory; cross-tenant and prompt-injection tests.

**Done when** repeated choices measurably affect pathway ordering and context
while the recorded model identifier remains unchanged and the user retains
control.

### Milestone 6 — Collaboration and production hardening

Deliverables: multi-user collaboration verification; role-based permissions;
rate limits and abuse controls; observability, structured errors, and cost
instrumentation; accessibility review; responsive layouts; performance budgets;
backup and recovery documentation; retention and deletion flows; security
review and dependency audit.

**Done when** the beta acceptance suite passes in the staging environment and
operational runbooks are usable.

### Milestone 7 — Beta release

Deliverables: production migration plan; feature flags and rollback switches;
beta onboarding; sample projects; user-facing privacy and memory controls;
final QA report; known-limitations document; release notes.

No production deployment or release-PR merge without explicit user
authorization where real users or production data are affected.

## 6. Definition of complete product beta

The beta is complete only when **all** of the following hold:

- A user can authenticate and work inside a securely isolated organization.
- A brief produces three to five meaningfully different pathways from one
  pinned foundation model.
- Pathways persist, can be compared, and can be selected.
- A selected pathway becomes a versioned intent graph.
- The resulting draft consists of stable blocks linked to intent and
  provenance.
- Clicking a generated block opens an accurate Intent Lens.
- Editing intent produces a correct impact preview.
- Targeted regeneration preserves unrelated and locked content.
- Regeneration cannot overwrite a collaborator's newer edit.
- Users can accept and reject proposed changes with diffs.
- Preference events influence later ranking and context without changing model
  weights.
- Preference memory is visible, editable, disableable, exportable, and
  resettable.
- RLS, cross-tenant isolation, secret handling, and prompt-injection defenses
  are tested.
- The critical end-to-end suite passes.
- The Supabase staging environment and preview workflows are healthy.
- Greptile has no unresolved actionable findings on release pull requests.
- Runbooks, migration steps, rollback instructions, and known limitations are
  documented.

## 7. Non-goals

- **No fine-tuning or model modification.** The foundation model is never
  fine-tuned, trained, merged, or extended with adapters. One pinned model per
  project; all adaptation is application-level (events, memory, retrieval,
  prompt context, reranking).
- **No chain-of-thought display or storage.** Hidden model reasoning is never
  persisted or shown. If a provider returns private reasoning fields, they are
  discarded (unless the provider designates an explicitly safe summary field).
  The Intent Lens presents application-owned intent data, not model
  introspection.
- **No graph-canvas-required UX.** A node-and-edge canvas is at most a
  progressive enhancement. Every essential operation — comparing pathways,
  inspecting intent, previewing impact, approving regeneration, managing
  memory — works from the outline, cards, and lens without touching a canvas.
- **No anthropomorphic framing.** The product does not claim the model "knows"
  or "understands" the user; it says the application has saved or learned
  preferences, all of which remain inspectable and reversible.
- **No replacement of Yjs collaboration with database subscriptions.** CRDT
  editing stays until an alternative proves equivalent through concurrency
  tests.
