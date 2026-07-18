# ADR 0002 — Supabase is the backend; App Router route handlers serve model streaming

- **Status**: Accepted (2026-07-18)

## Context

The forked tree has no backend (ADR 0001). The spec mandates Supabase for auth, tenancy,
domain state, RLS, realtime, storage, vectors, and jobs. Upstream's `AGENTS.md` convention
("App Router for routing only; no API routes") existed because their backend was a separate
NestJS service we don't have.

## Decision

1. **Supabase** provides: Auth (identity + JWT), Postgres with RLS as the tenancy boundary,
   domain tables (documents, pathways, intent graph, provenance, preferences, audit),
   Storage (source materials, exports), pgvector (preference/example retrieval), Realtime
   Broadcast (job progress) + Presence (participant state), queues/cron/Edge Functions for
   async embedding and cleanup work.
2. **Next.js App Router route handlers / server actions** (in `apps/DocFlow`) host the
   ModelGateway calls: pathway generation, draft streaming, explanation, regeneration.
   Rationale: streamed model responses need a long-lived Node runtime and server-held
   provider keys; Supabase Edge Function limits make them unsuitable for long streams.
   This **supersedes** the upstream "no API routes" convention; reviewers should treat
   route handlers under `app/api/**` (or server actions) as the sanctioned server boundary.
3. **Yjs stays** for collaborative editing (spec §3.5). The Hocuspocus websocket server
   cannot run on Vercel; until Milestone 3 we develop against a local Hocuspocus instance.
   Decision on the hosted collab path (small dedicated host vs Supabase-Realtime-backed
   provider vs Tiptap Cloud) is deferred to a follow-up ADR with concurrency test evidence.
4. Frontend service modules currently pointing at `NEXT_PUBLIC_SERVER_URL` are migrated
   per-domain to Supabase clients/route handlers; the env var is retired at the end of the
   migration rather than shimmed globally.

## Consequences

- RLS becomes the primary authorization layer; every table ships with policies + negative
  tests from Milestone 1 onward.
- Browser uses only the anon key + user JWT; service-role key exists only in server runtime.
- Supabase Branching provides per-PR isolated databases once linked to GitHub.
- The legacy socket.io notification client and MinIO-style upload flows are replaced by
  Supabase Realtime/Storage equivalents or removed (dispositions in `docs/architecture.md`).
