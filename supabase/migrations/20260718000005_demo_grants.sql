-- Table grants for the demo studio tables (20260718000004 created policies but
-- no grants — RLS policies are a filter, not a privilege; without grants every
-- authenticated query fails with "permission denied"). Mirrors the posture of
-- 20260718000002_tenancy_grants.sql: forced RLS + policies carry the tenancy
-- security; grants give the API roles baseline access for policies to filter.

revoke all on table public.pathway_sets, public.pathways, public.intent_nodes, public.doc_blocks
  from public, anon;

grant select, insert, update, delete on table
  public.pathway_sets, public.pathways, public.intent_nodes, public.doc_blocks
  to authenticated;

grant select, insert, update, delete on table
  public.pathway_sets, public.pathways, public.intent_nodes, public.doc_blocks
  to service_role;
