# Intent Writing Studio

**An AI writing product where you steer the *decisions*, not just the words.**

Most AI writing tools give you one draft and a chat box. This studio makes the machinery
legible and controllable: it proposes **3–5 genuinely different ways** to write your piece,
turns your chosen strategy into an **intent graph**, generates a draft whose every block is
**causally linked to an intention**, and when you change your mind about an intention it
shows you **exactly what will change before it changes** — then regenerates *only* the
affected, unlocked blocks and presents diffs you accept or reject.

## 🚀 Live demo

**https://intent-writing-studio.vercel.app**

1. Click **"Try the demo instantly"** on the sign-in page (or use `demo@nullfellows.dev` / `intent-demo-2026`).
2. Open the seeded demo document (or create a new one) in the **Studio**.
3. Walk the loop:
   - **Brief** — state your goal, audience, constraints.
   - **Pathways** — compare 3–5 meaningfully different strategies (thesis, tone, structure, trade-offs, and *how each differs from the others*). Pick one.
   - **Draft + Intent Lens** — read the generated draft; click any block to see *why it exists*: its intention, purpose, pathway provenance, dependencies, and freshness. Lock blocks you want preserved.
   - **Edit an intent** — change a section's goal. An **impact preview** lists every downstream intention and block that would go stale (locked blocks are excluded) *before* anything is rewritten.
   - **Targeted regeneration** — approve, and only the affected blocks are regenerated. Review side-by-side diffs; accept or reject per block.

The generation model is **frozen** (`claude-sonnet-5`, pinned per project). All adaptation
happens *around* the model — never by changing it.

## Architecture (what's real)

- **Foundation**: fork of [DocFlow](https://github.com/xun082/DocFlow) (MIT — attribution preserved, upstream README in `docs/UPSTREAM-README.md`). The public DocFlow tree is frontend-only; we built the entire backend on **Supabase**.
- **Database**: Postgres with **Row Level Security enabled and forced on every table**, multi-tenant (organizations → projects → documents), verified by **196 pgTAP assertions** (cross-tenant denial matrix, role gates, anon-blindness) run in CI from a clean database on every change.
- **Auth**: Supabase Auth — magic-link (PKCE, sanitized redirects) plus a password-based demo account. Server-validated sessions in middleware; the legacy auth layer (XSS-readable token cookies) was excised.
- **Intent & provenance data model**: `pathway_sets` → `pathways` → `intent_nodes` (dependency tree) → `doc_blocks` (content + hash + freshness + lock + proposal), all org-scoped under RLS.
- **Model gateway**: server-only route handlers call Anthropic; **every model output is Zod-validated before persistence or rendering** (invalid output triggers one repair retry); no chain-of-thought is stored or shown — the Intent Lens renders explicit, structured fields only.
- **CI**: type-check, zero-warning lint, build, migration apply from scratch, full pgTAP suite, and a generated-types drift check.

## Honest known limitations

This demo was assembled under deadline on top of two days of foundation work. What's *not* done:

1. **The demo studio view is a purpose-built document renderer, not the collaborative Tiptap/Yjs editor** that ships in the codebase. The Yjs editor needs a websocket relay (Hocuspocus) that isn't deployed; wiring provenance into live collaborative editing is designed (see `docs/`) but not integrated.
2. **Dependency edges are a tree** (parent → descendants), not the full typed DAG from the data model docs (`depends_on`, `supports`, `contrasts_with`…). Impact analysis = subtree + linked blocks.
3. **Preference memory / personalization is not in the demo.** The schema and design exist (`docs/data-model.md` §10), including pgvector retrieval and user-editable memory — not built yet.
4. **Pathway distinctness relies on prompting + Zod-enforced `differenceFromOthers`**; embedding-based duplicate detection and repair is designed, not implemented.
5. **Regeneration concurrency guards are hash-based and single-user in the demo.** The collaborative conflict case (a teammate editing a block mid-regeneration) is specified with tests in the roadmap, not demoed.
6. **Generation is synchronous** (up to ~60s per step) rather than streamed with durable job state; Vercel function limits bound draft length.
7. Parts of the inherited DocFlow UI outside the studio (dashboard widgets, chat, workflow canvas) still contain upstream's Chinese copy and dead legacy-API surfaces — they're inherited scaffolding, not the product.
8. Email magic-links on the hosted demo are rate-limited by Supabase's built-in SMTP (hence the password demo account).

## The two days behind the demo

Everything above the demo sits on real engineering, all merged with green CI and clean
AI+human review loops (see closed PRs #1–#3 and `docs/build-state.md`):

- Full repository audit + executable-baseline repair of the fork (upstream couldn't `pnpm install` from a clean checkout; a committed registry token and third-party deploy workflows were removed from CI; every dev-run previously phoned upstream's production servers — severed).
- Multi-tenant schema with forced RLS + 196-assertion security test suite, run from scratch in CI.
- Real auth with a browser-verified end-to-end flow.
- Threat model, data model, product spec, architecture map with a 69-endpoint inventory, ADRs, and a per-PR AI review loop (Greptile) with custom rules — including one round where the reviewer conceded a finding against empirical evidence.

## Running locally

```bash
pnpm install                       # Node >= 24, pnpm 10.28
supabase start && supabase db reset  # local stack + migrations + seed
cp .env.example apps/DocFlow/.env.local  # fill Supabase local values + ANTHROPIC_API_KEY
pnpm --dir apps/DocFlow dev
# sign in as alice.owner@nullfellows.dev via the local mail catcher (http://127.0.0.1:54324)
# or the demo account, then open /studio
supabase test db                   # 196 pgTAP assertions
```

## License

MIT. Built on DocFlow (MIT, © 2025 Moment) — upstream attribution preserved.
