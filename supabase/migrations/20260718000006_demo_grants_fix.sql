-- Align demo-table grants with the audited Milestone 1 posture
-- (20260718000002): client roles never hold TRUNCATE/TRIGGER/REFERENCES/
-- MAINTAIN (not subject to RLS); anon holds SELECT only (policies are
-- TO authenticated, so anon still sees zero rows).

revoke truncate, trigger, references, maintain on table
  public.pathway_sets, public.pathways, public.intent_nodes, public.doc_blocks
  from authenticated, anon, public;

grant select on table
  public.pathway_sets, public.pathways, public.intent_nodes, public.doc_blocks
  to anon;
