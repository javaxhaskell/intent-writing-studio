-- ============================================================================
-- 20260718000002_tenancy_grants.sql — explicit Data API grants for the
-- Milestone 1 tenancy tables (companion to 20260718000001_tenancy.sql).
--
-- Why this exists: supabase/config.toml documents the current platform
-- default — with api.auto_expose_new_tables unset, tables created in `public`
-- by `postgres` receive NO automatic SELECT/INSERT/UPDATE/DELETE grants for
-- the Data API roles (anon / authenticated / service_role). Under that
-- default every tenancy table would be unreachable through PostgREST for
-- every role, including service_role (BYPASSRLS skips policies, not ACLs).
-- The pgTAP suite under supabase/tests/ surfaced this as `permission denied
-- for table ...`.
--
-- Grant matrix (deliberately narrower than the legacy grant-ALL default —
-- least privilege per docs/security.md §4; RLS remains the tenant boundary).
-- Wherever the companion migration removes a client-side operation, the
-- grant is withheld here too, so the denial holds at the ACL layer as well
-- as at the policy layer:
--   * authenticated:
--       - organization_members: SELECT/INSERT/UPDATE/DELETE (row access
--         still gated by the owner-protecting RLS policies);
--       - projects, documents, source_materials: SELECT/INSERT/UPDATE only —
--         user-facing deletion is soft (UPDATE deleted_at, owner/admin via
--         RLS); hard DELETE is the scheduled purge job (service role), so
--         clients hold no DELETE grant at all;
--       - organizations: SELECT/UPDATE only (creation is RPC-only via
--         public.create_organization; soft delete is RPC-only via
--         public.soft_delete_organization — owner-gated; restore and hard
--         purge are server-side);
--       - document_versions: SELECT only (append-only AND server-path
--         INSERT only via public.create_document_version — clients can never
--         insert, update, or delete history directly).
--   * anon: SELECT only on all six tables. All policies are TO authenticated,
--     so anon sees zero rows; write grants are withheld entirely.
--   * service_role: SELECT/INSERT/UPDATE/DELETE on all six tables (workers,
--     purge jobs, server-side mutations; application code re-verifies
--     authorization per security.md T1).
--   * TRUNCATE / TRIGGER / REFERENCES / MAINTAIN are revoked from anon and
--     authenticated: the platform's residual default ACL still hands these to
--     client roles, and TRUNCATE in particular is NOT subject to RLS.
--
-- Future tables must ship their own explicit grants in the same migration
-- that creates them (the no-auto-expose default makes this the norm; the
-- pgTAP grant sweeps in supabase/tests/001_rls_enabled.sql enforce it).
--
-- Rollout: additive/privilege-only; no schema objects change.
-- Rollback: REVOKE the grants below and (if ever desired) re-GRANT
-- truncate/trigger/references/maintain to restore the prior ACL state.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Strip non-DML privileges the residual default ACL handed to client roles
--    (TRUNCATE bypasses RLS; clients get no DDL-adjacent privileges at all).
-- ----------------------------------------------------------------------------

revoke truncate, trigger, references, maintain on table
  public.organizations,
  public.organization_members,
  public.projects,
  public.documents,
  public.document_versions,
  public.source_materials
from anon, authenticated;

-- ----------------------------------------------------------------------------
-- 2. authenticated — RLS-guarded DML per the matrix above
-- ----------------------------------------------------------------------------

grant select, insert, update, delete on table
  public.organization_members
to authenticated;

-- No DELETE: user-facing deletion is soft (UPDATE deleted_at); hard deletion
-- is the purge job (service role) — see 20260718000001 header.
grant select, insert, update on table
  public.projects,
  public.documents,
  public.source_materials
to authenticated;

grant select, update on table public.organizations to authenticated;

-- SELECT only: append-only and server-path INSERT only
-- (public.create_document_version / service role).
grant select on table public.document_versions to authenticated;

-- ----------------------------------------------------------------------------
-- 3. anon — read grants only; every policy is TO authenticated, so anon
--    resolves to zero rows on every table
-- ----------------------------------------------------------------------------

grant select on table
  public.organizations,
  public.organization_members,
  public.projects,
  public.documents,
  public.document_versions,
  public.source_materials
to anon;

-- ----------------------------------------------------------------------------
-- 4. service_role — full DML for server-side workers and purge jobs
-- ----------------------------------------------------------------------------

grant select, insert, update, delete on table
  public.organizations,
  public.organization_members,
  public.projects,
  public.documents,
  public.document_versions,
  public.source_materials
to service_role;
