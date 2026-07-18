-- ============================================================================
-- 20260718000001_tenancy.sql — Milestone 1: tenancy and content core
--
-- Realizes docs/data-model.md §1 (Conventions), §2 (RLS posture), §3 (Tenancy
-- and content) for: organizations, organization_members, projects, documents,
-- document_versions, source_materials. Threat model: docs/security.md T1
-- (cross-tenant access) — every table here ships with RLS ENABLED **and**
-- FORCED plus a complete policy set in this same migration; no table is ever
-- exposed without policies.
--
-- Design decisions (documented deviations / choices):
--   * Helper functions live in `app_private`, which is NOT in the PostgREST
--     exposed schemas (supabase/config.toml api.schemas = public,
--     graphql_public) — do not add it there.
--   * Denormalized organization_id on deep tables (documents,
--     document_versions, source_materials) is kept consistent by composite
--     foreign keys — (parent_id, organization_id) REFERENCES
--     parent(id, organization_id) — no trigger needed; RLS stays one-hop.
--   * is_org_member/has_org_role require the organization to be live
--     (deleted_at is null): soft-deleting an organization immediately hides
--     and freezes its entire subtree for every member — a "deleted" tenant's
--     confidential content (security.md A4/A5) is not readable or writable
--     during the retention window. The purge job (service role, BYPASSRLS)
--     is unaffected; restore/undelete, if ever offered, is a server-side
--     operation.
--   * organizations has NO client INSERT policy: creation goes through the
--     SECURITY DEFINER RPC public.create_organization(name), which inserts the
--     org and the caller's `owner` membership atomically. It also has no
--     client DELETE policy, and soft delete is RPC-only too:
--     public.soft_delete_organization(org_id), owner-gated per data-model §3
--     ("soft delete by owner"). A bare client UPDATE cannot soft-delete an
--     org because the live-org helper gate makes the policy checks on the
--     new (soft-deleted) row self-blocking — by design, the RPC is the only
--     path. Restore/undelete and hard purge are server-side (service role).
--   * NO content table has a client hard-DELETE path: projects, documents and
--     source_materials are soft-deleted (UPDATE deleted_at) and hard-deleted
--     only by the scheduled purge job (service role), mirroring
--     organizations. This keeps document_versions history and storage-object
--     cleanup on the purge path (data-model §3/§8). The DELETE grants are
--     also withheld in 20260718000002_tenancy_grants.sql.
--   * Soft delete IS the user-facing deletion, so it is role-gated as
--     deletion (data-model §2: DELETE = owner/admin): each container's UPDATE
--     policy is split into *_update_editor (live rows only; can neither set
--     nor clear deleted_at) and *_update_admin (owner/admin; may soft-delete
--     and restore). Because PostgreSQL also checks an UPDATE's NEW rows
--     against the SELECT policies' USING expressions (anti-probing rule), the
--     SELECT policies on projects/documents/source_materials show soft-deleted
--     rows to owner/admin (their trash/restore view) while hiding them from
--     editor/reviewer/viewer — a plain `deleted_at is null` SELECT filter
--     would make even an admin's soft-delete UPDATE reject its own new row.
--   * source_materials soft delete is owner/admin-gated like the other
--     containers; the data-model §3 "user-deletable (uploader)" refinement is
--     deferred until an uploader column exists (extraction slice, see the
--     deferred-columns list below).
--   * document_versions is append-only AND server-path-insert-only
--     (data-model §3 "INSERT server-side only"): clients create snapshots
--     exclusively through public.create_document_version(doc_id, content), a
--     SECURITY DEFINER RPC that re-derives organization_id from the document
--     row, computes content_hash server-side (sha256 of the normalized jsonb
--     text), sets created_by = auth.uid(), and role-gates to
--     owner/admin/editor. No client INSERT/UPDATE/DELETE policies exist, and
--     the INSERT grant is withheld at the ACL layer too.
--   * organization_members write policies protect owner rows on both sides:
--     only owners may create, modify (promote/demote), or remove an
--     owner-role membership; admins manage admin-and-below. This blocks
--     admin -> owner self-escalation and admin demotion/removal of owners
--     (the owner/admin distinction of data-model §3).
--   * Last-owner guard (data-model §3 organization_members):
--     app_private.protect_last_owner() rejects demoting or deleting an
--     organization's final owner. The guard exempts rows whose parent
--     organizations row or auth.users row is already gone (ON DELETE CASCADE
--     fires after the parent row is deleted) and soft-deleted organizations
--     awaiting purge — so account deletion and tenant purge cascade cleanly.
--   * Tenancy keys are frozen after insert: BEFORE UPDATE triggers
--     (app_private.enforce_immutable_columns) reject changes to
--     organization_id (plus project_id on documents/source_materials and
--     user_id on organization_members). RLS WITH CHECK cannot reference the
--     OLD row, so cross-tenant re-parenting by a dual-org member is stopped
--     at the trigger layer instead.
--   * documents.kind is a value-set CHECK (currently exactly 'document'),
--     widened by migration as kinds are introduced — never free-form
--     (data-model §1).
--   * Deferred columns — tracked drift from data-model §3, deliberately
--     deferred to the slice that first uses them (not silently dropped):
--       - documents.current_version_id (FK -> document_versions, on delete
--         set null) and documents.brief jsonb        -> snapshot slice (M2)
--       - document_versions.cause + snapshot_kind    -> snapshot slice (M2);
--         `cause` lands with the §8 value-set CHECK
--         (manual | pre_regeneration | scheduled | milestone)
--       - source_materials.document_id (nullable FK), title, extracted_text,
--         extraction_status (value-set CHECK)        -> extraction slice (M2)
--   * Table grants are explicit in 20260718000002_tenancy_grants.sql (the
--     platform default no longer auto-grants new tables to the Data API
--     roles); safety comes from forced RLS with policies scoped
--     `TO authenticated`.
--   * FORCE RLS also binds the table owner; Supabase's `postgres` role and
--     `service_role` carry BYPASSRLS, so migrations, seeds, and server-side
--     workers are unaffected (server code must re-verify authorization in
--     application logic per security.md T1).
--
-- Rollout: purely additive (new schema, type, tables, functions, policies).
-- Rollback: drop policies, triggers, tables, functions, type, schema in
-- reverse order; no pre-existing objects are modified.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Extensions and private helper schema (never exposed via PostgREST)
-- ----------------------------------------------------------------------------

-- pgcrypto is used by supabase/seed.sql (extensions.crypt for deterministic
-- password hashes). Declared explicitly so a clean reset never depends on the
-- Supabase image happening to pre-install it; idempotent on current images
-- where it already exists in the extensions schema.
create extension if not exists pgcrypto with schema extensions;

create schema if not exists app_private;

revoke all on schema app_private from public;
revoke all on schema app_private from anon;
-- Policies run with the querying role's privileges, so `authenticated` needs
-- USAGE here (and EXECUTE on the helpers) for policy evaluation to work.
grant usage on schema app_private to authenticated;

comment on schema app_private is
  'Security-definer helpers and trigger functions. Must never be added to the PostgREST exposed schemas (api.schemas in supabase/config.toml).';

-- ----------------------------------------------------------------------------
-- 2. Role enum
-- ----------------------------------------------------------------------------

-- Role set per docs/data-model.md §3 organization_members (final set to
-- confirm; `reviewer` = the spec's commenter/reviewer role).
create type public.org_role as enum ('owner', 'admin', 'editor', 'reviewer', 'viewer');

-- ----------------------------------------------------------------------------
-- 3. Generic trigger functions
-- ----------------------------------------------------------------------------

create function app_private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

comment on function app_private.set_updated_at() is
  'BEFORE UPDATE trigger: maintains updated_at on mutable tables (data-model §1).';

-- Freezes tenancy/parent keys after insert. RLS WITH CHECK cannot see the OLD
-- row, so without this a user holding editor+ in two orgs could re-parent a
-- row across tenants (USING passes in org A, WITH CHECK passes in org B).
-- Column names to freeze are passed as trigger arguments (TG_ARGV).
create function app_private.enforce_immutable_columns()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  col text;
begin
  foreach col in array tg_argv loop
    if (to_jsonb(new) -> col) is distinct from (to_jsonb(old) -> col) then
      raise exception '%.%: column % is immutable', tg_table_schema, tg_table_name, col
        using errcode = '42501';
    end if;
  end loop;
  return new;
end;
$$;

comment on function app_private.enforce_immutable_columns() is
  'BEFORE UPDATE trigger: rejects changes to the columns named in TG_ARGV (tenancy/parent keys are frozen after insert; security.md T1).';

-- ----------------------------------------------------------------------------
-- 4. Tables (RLS enabled + forced immediately after each CREATE TABLE)
-- ----------------------------------------------------------------------------

-- ---- organizations ---------------------------------------------------------
-- Tenancy root; the isolation boundary for RLS and preference scoping.

create table public.organizations (
  id         uuid primary key default gen_random_uuid(),
  name       text not null constraint organizations_name_not_blank check (btrim(name) <> ''),
  slug       text not null unique
             constraint organizations_slug_format check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  settings   jsonb not null default '{}'::jsonb,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.organizations enable row level security;
alter table public.organizations force row level security;

create trigger organizations_set_updated_at
  before update on public.organizations
  for each row execute function app_private.set_updated_at();

comment on table public.organizations is
  'Tenancy root (data-model §3). Client creation only via public.create_organization(); client soft delete only via public.soft_delete_organization() (owner); hard purge is a scheduled server-side job.';

-- ---- organization_members --------------------------------------------------
-- Maps auth users to organizations with a role; the join the RLS helpers
-- consult. Policies must not query this table inline (recursion) — they use
-- the security-definer helpers below.

create table public.organization_members (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null
                  references public.organizations (id) on delete cascade,
  user_id         uuid not null
                  references auth.users (id) on delete cascade,
  role            public.org_role not null,
  invited_by      uuid
                  references auth.users (id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (organization_id, user_id)
);

alter table public.organization_members enable row level security;
alter table public.organization_members force row level security;

create index organization_members_user_id_idx on public.organization_members (user_id);
create index organization_members_invited_by_idx on public.organization_members (invited_by);

create trigger organization_members_set_updated_at
  before update on public.organization_members
  for each row execute function app_private.set_updated_at();

create trigger organization_members_tenancy_immutable
  before update on public.organization_members
  for each row execute function app_private.enforce_immutable_columns('organization_id', 'user_id');

comment on table public.organization_members is
  'Org membership + role (data-model §3). Hard delete on removal. Owner rows are writable only by owners; the last owner cannot be demoted or removed (app_private.protect_last_owner).';

-- ---- projects --------------------------------------------------------------
-- Groups documents; unit of model pinning (frozen model per project).

create table public.projects (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null
                  references public.organizations (id) on delete cascade,
  name            text not null constraint projects_name_not_blank check (btrim(name) <> ''),
  description     text,
  -- The frozen pinned model (docs/data-model.md §3, CLAUDE.md non-negotiable).
  -- Changing it is an explicit, audited user action.
  llm_provider    text not null default 'anthropic'
                  constraint projects_llm_provider_not_blank check (btrim(llm_provider) <> ''),
  llm_model       text not null default 'claude-sonnet-5'
                  constraint projects_llm_model_not_blank check (btrim(llm_model) <> ''),
  settings        jsonb not null default '{}'::jsonb,
  deleted_at      timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  -- Composite target so child tables' denormalized organization_id is
  -- FK-enforced consistent with the parent project.
  unique (id, organization_id)
);

alter table public.projects enable row level security;
alter table public.projects force row level security;

create index projects_organization_id_idx on public.projects (organization_id);

create trigger projects_set_updated_at
  before update on public.projects
  for each row execute function app_private.set_updated_at();

create trigger projects_tenancy_immutable
  before update on public.projects
  for each row execute function app_private.enforce_immutable_columns('organization_id');

comment on table public.projects is
  'Document container + pinned LLM provider/model (data-model §3). Soft delete via deleted_at (owner/admin only); hard delete is the purge job.';

-- ---- documents -------------------------------------------------------------
-- A single collaborative document. Durable metadata only; live collaborative
-- state is Yjs (data-model §3).

create table public.documents (
  id              uuid primary key default gen_random_uuid(),
  project_id      uuid not null,
  organization_id uuid not null,  -- denormalized for one-hop RLS (data-model §1)
  title           text not null default 'Untitled'
                  constraint documents_title_not_blank check (btrim(title) <> ''),
  -- Type discriminator; value-set CHECK per data-model §1 (never free-form).
  -- Widen the set by migration as new kinds are introduced.
  kind            text not null default 'document'
                  constraint documents_kind_check check (kind in ('document')),
  deleted_at      timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  -- Composite FK keeps the denormalized organization_id consistent with the
  -- parent project; deleting the project (purge path) cascades here.
  foreign key (project_id, organization_id)
    references public.projects (id, organization_id) on delete cascade,
  -- Composite target for document_versions' denormalized organization_id.
  unique (id, organization_id)
);

alter table public.documents enable row level security;
alter table public.documents force row level security;

create index documents_project_id_idx on public.documents (project_id);
create index documents_organization_id_idx on public.documents (organization_id);

create trigger documents_set_updated_at
  before update on public.documents
  for each row execute function app_private.set_updated_at();

create trigger documents_tenancy_immutable
  before update on public.documents
  for each row execute function app_private.enforce_immutable_columns('organization_id', 'project_id');

comment on table public.documents is
  'Collaborative document metadata (data-model §3). Soft delete via deleted_at (owner/admin only); purge cascades the subtree.';

-- ---- document_versions -----------------------------------------------------
-- Immutable document-level snapshots. Append-only: created_at only, no
-- updated_at trigger, no UPDATE/DELETE policies, and no client INSERT —
-- snapshots are created through public.create_document_version() only.

create table public.document_versions (
  id              uuid primary key default gen_random_uuid(),
  document_id     uuid not null,
  organization_id uuid not null,  -- denormalized for one-hop RLS
  content         jsonb not null,
  content_hash    text not null
                  constraint document_versions_content_hash_not_blank check (btrim(content_hash) <> ''),
  -- Nullable so ON DELETE SET NULL can keep history when the author's
  -- auth.users row is deleted; the server-side insert path always sets it.
  created_by      uuid
                  references auth.users (id) on delete set null,
  created_at      timestamptz not null default now(),
  foreign key (document_id, organization_id)
    references public.documents (id, organization_id) on delete cascade
);

alter table public.document_versions enable row level security;
alter table public.document_versions force row level security;

create index document_versions_document_id_idx on public.document_versions (document_id);
create index document_versions_organization_id_idx on public.document_versions (organization_id);
create index document_versions_created_by_idx on public.document_versions (created_by);

comment on table public.document_versions is
  'Append-only document snapshots (data-model §3). Inserted only via public.create_document_version() or server-side; never updated or client-deleted; thinned/purged only by retention jobs (§8).';

-- ---- source_materials ------------------------------------------------------
-- User-supplied uploads that ground generation. Untrusted input and the
-- primary prompt-injection carrier (security.md T3/A5): rows start
-- injection_scan_status = 'pending' until screened.

create table public.source_materials (
  id                    uuid primary key default gen_random_uuid(),
  project_id            uuid not null,
  organization_id       uuid not null,  -- denormalized for one-hop RLS
  storage_path          text not null
                        constraint source_materials_storage_path_not_blank check (btrim(storage_path) <> ''),
  mime_type             text not null
                        constraint source_materials_mime_type_not_blank check (btrim(mime_type) <> ''),
  injection_scan_status text not null default 'pending'
                        constraint source_materials_injection_scan_status_check
                        check (injection_scan_status in ('pending', 'passed', 'flagged', 'failed')),
  deleted_at            timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  foreign key (project_id, organization_id)
    references public.projects (id, organization_id) on delete cascade,
  -- Exactly one row owns each storage object, so purge propagation
  -- (data-model §8: purging a material removes its object) is well-defined.
  constraint source_materials_storage_path_key unique (storage_path)
);

alter table public.source_materials enable row level security;
alter table public.source_materials force row level security;

create index source_materials_project_id_idx on public.source_materials (project_id);
create index source_materials_organization_id_idx on public.source_materials (organization_id);

create trigger source_materials_set_updated_at
  before update on public.source_materials
  for each row execute function app_private.set_updated_at();

create trigger source_materials_tenancy_immutable
  before update on public.source_materials
  for each row execute function app_private.enforce_immutable_columns('organization_id', 'project_id');

comment on table public.source_materials is
  'Uploaded briefs/references (data-model §3). Untrusted until injection screening (security.md T3). Storage bucket policies must mirror these table policies.';

-- ----------------------------------------------------------------------------
-- 5. Security-definer membership helpers (defined after organization_members)
-- ----------------------------------------------------------------------------
-- SECURITY DEFINER (owner has BYPASSRLS) so policies on organization_members
-- itself can call them without infinite recursion. STABLE + pinned empty
-- search_path per security.md §4 least-privilege posture.
--
-- Both helpers require the organization to be live (deleted_at is null):
-- soft-deleting an org revokes every member's access to the whole subtree at
-- once (see header). Purge jobs run as service_role/postgres (BYPASSRLS) and
-- never evaluate these.

create function app_private.is_org_member(org_uuid uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.organization_members m
    join public.organizations o on o.id = m.organization_id
    where m.organization_id = org_uuid
      and m.user_id = (select auth.uid())
      and o.deleted_at is null
  );
$$;

comment on function app_private.is_org_member(uuid) is
  'True when auth.uid() has any membership in the given LIVE (not soft-deleted) organization. RLS SELECT gate (data-model §2).';

create function app_private.has_org_role(org_uuid uuid, roles text[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.organization_members m
    join public.organizations o on o.id = m.organization_id
    where m.organization_id = org_uuid
      and m.user_id = (select auth.uid())
      and m.role::text = any (roles)
      and o.deleted_at is null
  );
$$;

comment on function app_private.has_org_role(uuid, text[]) is
  'True when auth.uid() holds one of the given roles in the LIVE (not soft-deleted) organization. RLS write gate (data-model §2).';

-- Last-owner guard (data-model §3): an organization must always retain at
-- least one owner. SECURITY DEFINER so the owner count sees all rows and the
-- parent-existence checks can read auth.users. Cascade-safe by construction:
-- when the organizations row or the member's auth.users row is already gone,
-- the ON DELETE CASCADE that fired this trigger must not be blocked.
create function app_private.protect_last_owner()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Only removing or demoting an owner row can strand an organization.
  if old.role <> 'owner' then
    return coalesce(new, old);
  end if;
  if tg_op = 'UPDATE'
     and new.role = 'owner'
     and new.organization_id = old.organization_id then
    return new;
  end if;

  -- Org purge cascade (organizations row already deleted) and soft-deleted
  -- orgs awaiting purge are exempt.
  if not exists (
    select 1
    from public.organizations o
    where o.id = old.organization_id
      and o.deleted_at is null
  ) then
    return coalesce(new, old);
  end if;

  -- Account-deletion cascade: the auth.users row is already deleted when the
  -- FK cascade removes the membership rows — do not block it.
  if tg_op = 'DELETE' and not exists (
    select 1 from auth.users u where u.id = old.user_id
  ) then
    return old;
  end if;

  if not exists (
    select 1
    from public.organization_members m
    where m.organization_id = old.organization_id
      and m.role = 'owner'
      and m.id <> old.id
  ) then
    raise exception 'organization_members: an organization must retain at least one owner'
      using errcode = '23514';
  end if;

  return coalesce(new, old);
end;
$$;

comment on function app_private.protect_last_owner() is
  'BEFORE UPDATE/DELETE trigger on organization_members: rejects demoting or removing an organization''s final owner; exempts cascades from organizations/auth.users deletes and soft-deleted orgs awaiting purge.';

create trigger organization_members_protect_last_owner
  before update or delete on public.organization_members
  for each row execute function app_private.protect_last_owner();

-- Function EXECUTE defaults to PUBLIC — pull it back to authenticated only.
revoke execute on function app_private.set_updated_at() from public;
revoke execute on function app_private.enforce_immutable_columns() from public;
revoke execute on function app_private.protect_last_owner() from public;
revoke execute on function app_private.is_org_member(uuid) from public;
revoke execute on function app_private.has_org_role(uuid, text[]) from public;
grant execute on function app_private.is_org_member(uuid) to authenticated;
grant execute on function app_private.has_org_role(uuid, text[]) to authenticated;

-- ----------------------------------------------------------------------------
-- 6. Policies
-- ----------------------------------------------------------------------------
-- Baseline (data-model §2): SELECT for members; INSERT role-gated; UPDATE
-- split so content edits are editor+ while soft delete/restore (the
-- user-facing deletion) is owner/admin; NO client hard-DELETE policy on any
-- content table (hard deletion is the purge job). All policies are scoped
-- TO authenticated; anon matches no policy and forced RLS denies it
-- everything.

-- ---- organizations ----
-- No INSERT policy (creation via public.create_organization only) and no
-- DELETE policy (soft delete via public.soft_delete_organization only; hard
-- purge is server-side) — see header.

create policy organizations_select
  on public.organizations
  for select
  to authenticated
  using (deleted_at is null and app_private.is_org_member(id));

-- WITH CHECK pins deleted_at: a client UPDATE can never produce a
-- soft-deleted org row (soft delete is public.soft_delete_organization).
create policy organizations_update
  on public.organizations
  for update
  to authenticated
  using (app_private.has_org_role(id, array['owner', 'admin']))
  with check (
    deleted_at is null
    and app_private.has_org_role(id, array['owner', 'admin'])
  );

-- ---- organization_members ----
-- Visible to co-members; writable by owner/admin only (data-model §3), with
-- owner rows protected on BOTH sides of every write: USING sees the old row
-- (an existing owner row can only be touched by an owner) and WITH CHECK the
-- new row (only an owner can produce an owner row). This blocks
-- admin -> owner self-promotion, admin demotion of owners, admin removal of
-- owners, and inserting fresh owner rows as a mere admin. WITH CHECK also
-- re-gates on the row's organization_id, so a member row can never be
-- inserted into an org the actor does not administer.

create policy organization_members_select
  on public.organization_members
  for select
  to authenticated
  using (app_private.is_org_member(organization_id));

create policy organization_members_insert
  on public.organization_members
  for insert
  to authenticated
  with check (
    app_private.has_org_role(organization_id, array['owner', 'admin'])
    and (role <> 'owner' or app_private.has_org_role(organization_id, array['owner']))
  );

create policy organization_members_update
  on public.organization_members
  for update
  to authenticated
  using (
    app_private.has_org_role(organization_id, array['owner', 'admin'])
    and (role <> 'owner' or app_private.has_org_role(organization_id, array['owner']))
  )
  with check (
    app_private.has_org_role(organization_id, array['owner', 'admin'])
    and (role <> 'owner' or app_private.has_org_role(organization_id, array['owner']))
  );

create policy organization_members_delete
  on public.organization_members
  for delete
  to authenticated
  using (
    app_private.has_org_role(organization_id, array['owner', 'admin'])
    and (role <> 'owner' or app_private.has_org_role(organization_id, array['owner']))
  );

-- ---- projects ----
-- UPDATE is split so soft delete is role-gated as deletion (data-model §2:
-- DELETE = owner/admin). No client DELETE policy: hard deletion is the purge
-- job only.

-- Soft-deleted rows stay visible to owner/admin (the roles that can delete
-- and restore — PG checks an UPDATE's new rows against this USING) and are
-- hidden from everyone else.
create policy projects_select
  on public.projects
  for select
  to authenticated
  using (
    app_private.is_org_member(organization_id)
    and (
      deleted_at is null
      or app_private.has_org_role(organization_id, array['owner', 'admin'])
    )
  );

create policy projects_insert
  on public.projects
  for insert
  to authenticated
  with check (app_private.has_org_role(organization_id, array['owner', 'admin', 'editor']));

create policy projects_update_editor
  on public.projects
  for update
  to authenticated
  using (
    deleted_at is null
    and app_private.has_org_role(organization_id, array['owner', 'admin', 'editor'])
  )
  with check (
    deleted_at is null
    and app_private.has_org_role(organization_id, array['owner', 'admin', 'editor'])
  );

create policy projects_update_admin
  on public.projects
  for update
  to authenticated
  using (app_private.has_org_role(organization_id, array['owner', 'admin']))
  with check (app_private.has_org_role(organization_id, array['owner', 'admin']));

-- ---- documents ----
-- Same split as projects; no client DELETE policy (a client hard DELETE
-- would cascade-destroy the append-only document_versions history).

-- Soft-deleted rows visible to owner/admin only (see projects_select note).
create policy documents_select
  on public.documents
  for select
  to authenticated
  using (
    app_private.is_org_member(organization_id)
    and (
      deleted_at is null
      or app_private.has_org_role(organization_id, array['owner', 'admin'])
    )
  );

create policy documents_insert
  on public.documents
  for insert
  to authenticated
  with check (app_private.has_org_role(organization_id, array['owner', 'admin', 'editor']));

create policy documents_update_editor
  on public.documents
  for update
  to authenticated
  using (
    deleted_at is null
    and app_private.has_org_role(organization_id, array['owner', 'admin', 'editor'])
  )
  with check (
    deleted_at is null
    and app_private.has_org_role(organization_id, array['owner', 'admin', 'editor'])
  );

create policy documents_update_admin
  on public.documents
  for update
  to authenticated
  using (app_private.has_org_role(organization_id, array['owner', 'admin']))
  with check (app_private.has_org_role(organization_id, array['owner', 'admin']));

-- ---- document_versions (append-only, server-path INSERT only) ----
-- SELECT for members; INSERT exclusively via public.create_document_version()
-- (or service role); no client INSERT/UPDATE/DELETE policies — forced RLS
-- plus the withheld grants deny everything else for every client role.

create policy document_versions_select
  on public.document_versions
  for select
  to authenticated
  using (app_private.is_org_member(organization_id));

-- ---- source_materials ----
-- Same split as projects/documents; no client DELETE policy (hard delete
-- would orphan the Supabase Storage object — purge owns object cleanup).

-- Soft-deleted rows visible to owner/admin only (see projects_select note).
create policy source_materials_select
  on public.source_materials
  for select
  to authenticated
  using (
    app_private.is_org_member(organization_id)
    and (
      deleted_at is null
      or app_private.has_org_role(organization_id, array['owner', 'admin'])
    )
  );

create policy source_materials_insert
  on public.source_materials
  for insert
  to authenticated
  with check (app_private.has_org_role(organization_id, array['owner', 'admin', 'editor']));

create policy source_materials_update_editor
  on public.source_materials
  for update
  to authenticated
  using (
    deleted_at is null
    and app_private.has_org_role(organization_id, array['owner', 'admin', 'editor'])
  )
  with check (
    deleted_at is null
    and app_private.has_org_role(organization_id, array['owner', 'admin', 'editor'])
  );

create policy source_materials_update_admin
  on public.source_materials
  for update
  to authenticated
  using (app_private.has_org_role(organization_id, array['owner', 'admin']))
  with check (app_private.has_org_role(organization_id, array['owner', 'admin']));

-- ----------------------------------------------------------------------------
-- 7. RPCs (SECURITY DEFINER server paths reachable from the client)
-- ----------------------------------------------------------------------------

-- ---- create_organization: atomic org + owner membership --------------------
-- Any authenticated user may create an organization and becomes its owner in
-- the same transaction (data-model §3 organizations). SECURITY DEFINER because
-- the caller has no membership yet, so no table policy could admit these two
-- inserts; the function is the single client-side creation path.

create function public.create_organization(name text)
returns public.organizations
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  caller_id uuid;
  base_slug text;
  new_org   public.organizations;
begin
  caller_id := (select auth.uid());
  if caller_id is null then
    raise exception 'create_organization: authentication required'
      using errcode = '42501';
  end if;

  if create_organization.name is null or btrim(create_organization.name) = '' then
    raise exception 'create_organization: name must not be empty'
      using errcode = '22023';
  end if;

  -- Derive a URL-safe slug from the name; a random suffix guarantees the
  -- UNIQUE(slug) constraint is met without a retry loop.
  base_slug := regexp_replace(lower(btrim(create_organization.name)), '[^a-z0-9]+', '-', 'g');
  base_slug := btrim(base_slug, '-');
  if base_slug = '' then
    base_slug := 'org';
  end if;
  -- Trim again after truncation so a cut landing on a hyphen cannot produce
  -- '--' when the suffix is appended (slug format constraint forbids it).
  base_slug := btrim(left(base_slug, 48), '-');
  base_slug := base_slug || '-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8);

  insert into public.organizations (name, slug)
  values (btrim(create_organization.name), base_slug)
  returning * into new_org;

  insert into public.organization_members (organization_id, user_id, role)
  values (new_org.id, caller_id, 'owner');

  return new_org;
end;
$$;

comment on function public.create_organization(text) is
  'Creates an organization and the calling user''s owner membership atomically. The only client-side path for inserting organizations (data-model §3).';

revoke execute on function public.create_organization(text) from public;
revoke execute on function public.create_organization(text) from anon;
grant execute on function public.create_organization(text) to authenticated;
grant execute on function public.create_organization(text) to service_role;

-- ---- soft_delete_organization: the only client path to delete a tenant -----
-- data-model §3 organizations: "soft delete by owner". Owner-gated (stricter
-- than the owner/admin UPDATE gate: deleting the whole tenant is the most
-- destructive client action). A bare UPDATE cannot do this: once deleted_at
-- is set, the live-org helpers evaluate false against the new row, so the
-- policy checks self-block — this RPC (definer, BYPASSRLS owner) is the one
-- deliberate path. Hard purge of the subtree remains the scheduled
-- server-side job; restore/undelete is server-side only.

create function public.soft_delete_organization(org_id uuid)
returns public.organizations
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  caller_id uuid;
  org_row   public.organizations;
begin
  caller_id := (select auth.uid());
  if caller_id is null then
    raise exception 'soft_delete_organization: authentication required'
      using errcode = '42501';
  end if;

  -- has_org_role requires the org to be live, so an already-soft-deleted org
  -- yields the same error as a foreign or nonexistent one (no oracle).
  if not app_private.has_org_role(soft_delete_organization.org_id, array['owner']) then
    raise exception 'soft_delete_organization: organization not found or not authorized'
      using errcode = '42501';
  end if;

  update public.organizations
     set deleted_at = now()
   where id = soft_delete_organization.org_id
     and deleted_at is null
  returning * into org_row;

  return org_row;
end;
$$;

comment on function public.soft_delete_organization(uuid) is
  'Soft-deletes an organization (owner only; data-model §3). The only client path to set organizations.deleted_at; the whole subtree becomes inaccessible immediately (live-org RLS helpers). Hard purge + restore are server-side.';

revoke execute on function public.soft_delete_organization(uuid) from public;
revoke execute on function public.soft_delete_organization(uuid) from anon;
grant execute on function public.soft_delete_organization(uuid) to authenticated;
grant execute on function public.soft_delete_organization(uuid) to service_role;

-- ---- create_document_version: the only client-reachable snapshot path ------
-- data-model §3: document_versions INSERT is server-side only. This RPC is
-- that server path for interactive snapshots: it re-derives organization_id
-- from the document row (never trusts a client-supplied org), computes
-- content_hash server-side (the hash is derived, not client-asserted), sets
-- created_by = auth.uid(), and role-gates to owner/admin/editor via the
-- live-org helper. Background workers use the service role instead.

create function public.create_document_version(doc_id uuid, content jsonb)
returns public.document_versions
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  caller_id   uuid;
  target_org  uuid;
  new_version public.document_versions;
begin
  caller_id := (select auth.uid());
  if caller_id is null then
    raise exception 'create_document_version: authentication required'
      using errcode = '42501';
  end if;

  if create_document_version.content is null then
    raise exception 'create_document_version: content must not be null'
      using errcode = '22023';
  end if;

  select d.organization_id
    into target_org
    from public.documents d
   where d.id = create_document_version.doc_id
     and d.deleted_at is null;

  -- One error for "does not exist" and "not authorized" — no existence oracle
  -- for other tenants' document ids.
  if target_org is null
     or not app_private.has_org_role(target_org, array['owner', 'admin', 'editor']) then
    raise exception 'create_document_version: document not found or not authorized'
      using errcode = '42501';
  end if;

  insert into public.document_versions (document_id, organization_id, content, content_hash, created_by)
  values (
    create_document_version.doc_id,
    target_org,
    create_document_version.content,
    encode(sha256(convert_to(create_document_version.content::text, 'UTF8')), 'hex'),
    caller_id
  )
  returning * into new_version;

  return new_version;
end;
$$;

comment on function public.create_document_version(uuid, jsonb) is
  'Creates an append-only document snapshot. The only client-reachable INSERT path for document_versions (data-model §3 "INSERT server-side only"): org re-derived from the document, content_hash computed server-side, created_by = auth.uid(), role-gated owner/admin/editor.';

revoke execute on function public.create_document_version(uuid, jsonb) from public;
revoke execute on function public.create_document_version(uuid, jsonb) from anon;
grant execute on function public.create_document_version(uuid, jsonb) to authenticated;
grant execute on function public.create_document_version(uuid, jsonb) to service_role;
