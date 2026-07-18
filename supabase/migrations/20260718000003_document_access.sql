-- ============================================================================
-- 20260718000003_document_access.sql — document access RPC for the editor gate
--
-- public.get_document_access(p_document_id uuid): the single client-side
-- bootstrap answering "may this user open this document, and with which
-- capabilities?" for the apps/DocFlow /docs/[room] editor gate. Returns at
-- most one row (role, can_edit, can_comment); ZERO rows uniformly mean
-- "not found, not a member, or soft-deleted" — no existence oracle for
-- foreign document ids, matching the unified error posture of the §7 RPCs in
-- 20260718000001_tenancy.sql (e.g. create_document_version).
--
-- Capability mapping per docs/data-model.md §3 (`reviewer` = the spec's
-- commenter/reviewer role):
--   owner / admin / editor -> can_edit + can_comment
--   reviewer               -> can_comment only
--   viewer                 -> neither (read-only)
--
-- Why SECURITY DEFINER rather than invoker:
--   * documents_select intentionally shows soft-deleted rows to owner/admin
--     (their trash/restore view — see 20260718000001 header), so an invoker
--     query against documents would report an admin's trashed document as
--     openable. "Row visible under RLS" is not "may open the editor"; this
--     function pins its own liveness predicate (d.deleted_at is null AND
--     o.deleted_at is null).
--   * An invoker function would still evaluate the SECURITY DEFINER
--     app_private helpers inside the organization_members policies, so
--     invoker buys no purity.
--   * Repo precedent: every §7 RPC is definer + pinned empty search_path.
--
-- The org-liveness join mirrors app_private.is_org_member's live-org
-- semantics (soft-deleting an org freezes its whole subtree at once);
-- organization_members is queried directly rather than via the helpers
-- because the helpers return booleans, not the concrete role.
--
-- The Hocuspocus `server:permission` stateless message remains the
-- authoritative runtime read-only flag; this RPC replaces only the legacy
-- HTTP permission bootstrap.
--
-- Rollout: purely additive (one new function + its grants).
-- Rollback: drop function public.get_document_access(uuid);
-- ============================================================================

create function public.get_document_access(p_document_id uuid)
returns table (role text, can_edit boolean, can_comment boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select
    m.role::text                                       as role,
    m.role in ('owner', 'admin', 'editor')             as can_edit,
    m.role in ('owner', 'admin', 'editor', 'reviewer') as can_comment
  from public.documents d
  join public.organizations o
    on o.id = d.organization_id
   and o.deleted_at is null
  join public.organization_members m
    on m.organization_id = d.organization_id
   and m.user_id = (select auth.uid())
  where d.id = p_document_id
    and d.deleted_at is null;
$$;

comment on function public.get_document_access(uuid) is
  'Editor-gate bootstrap: the caller''s role and capabilities on a LIVE document in a LIVE organization. At most one row; zero rows = not found / not a member / soft-deleted (no existence oracle). owner/admin/editor edit+comment, reviewer comment-only, viewer neither.';

-- Function EXECUTE defaults to PUBLIC — pull it back so only authenticated
-- clients (and server-side service_role callers) can reach it; anon must not
-- be able to probe document ids.
revoke execute on function public.get_document_access(uuid) from public;
revoke execute on function public.get_document_access(uuid) from anon;
grant execute on function public.get_document_access(uuid) to authenticated;
grant execute on function public.get_document_access(uuid) to service_role;
