# Review guidance for intent-writing-studio

This fork of DocFlow (MIT) is being turned into an AI writing product whose core promises are
**control and legibility**: users see why every block of a document exists (intent graph +
provenance), preview impact before regeneration, and own an editable preference memory.
One frozen foundation model per project — personalization happens around the model, never by
training it.

When reviewing, prioritize in this order:

1. **Tenancy and secrets** — RLS on every public table with negative tests; service-role key
   and provider keys server-only; nothing sensitive in client bundles or fixtures.
2. **Provenance integrity** — generated blocks always trace to intent nodes, pathways, and
   generation runs; content hashes guard every regeneration write; locked blocks untouched.
3. **Model-output hygiene** — Zod validation before persistence/rendering; sanitized rich
   content; no hidden chain-of-thought stored or displayed anywhere.
4. **Concurrency safety** — proposals never clobber newer Yjs edits; conflicted proposals are
   surfaced, not force-applied; jobs idempotent and cancellable.
5. **Auditability** — versions + audit events for every consequential mutation; preference
   events append-only; inferred preferences reversible.

Codebase conventions: see `CLAUDE.md`. The upstream "no API routes" rule is superseded by
ADR 0002 (Supabase backend + App Router route handlers for model streaming). Flag any direct
provider SDK usage outside the ModelGateway, any parallel data model duplicating existing
truth, and any documentation describing future state as if it already exists.
