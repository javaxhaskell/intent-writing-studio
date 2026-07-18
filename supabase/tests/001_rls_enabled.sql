-- ============================================================================
-- 001_rls_enabled.sql — structural RLS posture for the tenancy migrations
--
-- Verifies docs/data-model.md §2 (RLS posture) and docs/security.md T1 against
-- supabase/migrations/20260718000001_tenancy.sql and
-- supabase/migrations/20260718000002_tenancy_grants.sql:
--   * every public table has RLS ENABLED **and** FORCED;
--   * every public table carries its complete, exactly-named policy set —
--     no table is exposed without policies;
--   * append-only / RPC-only / soft-delete surfaces have no policies where
--     the migrations say so: document_versions has no INSERT/UPDATE/DELETE
--     policy (server-path INSERT via create_document_version only),
--     organizations has no INSERT/DELETE policy, and no content table has a
--     client hard-DELETE policy (hard deletion is the purge job);
--   * every policy is scoped TO authenticated (anon matches no policy);
--   * the explicit grant matrix holds (the platform no longer auto-grants
--     table access to Data API roles — api.auto_expose_new_tables unset),
--     including the withheld DELETE (content tables) and INSERT
--     (document_versions) grants;
--   * the security-definer helpers and RPCs live where the migration says,
--     with locked-down EXECUTE, and anon cannot reach any of them.
--
-- Run with: supabase test db
-- ============================================================================

begin;

create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;

select plan(58);

-- ---------------------------------------------------------------------------
-- Exact table inventory: nothing ships in public beyond the six tenancy tables
-- ---------------------------------------------------------------------------

select tables_are(
  'public',
  array[
    'organizations',
    'organization_members',
    'projects',
    'documents',
    'document_versions',
    'source_materials',
    'pathway_sets',
    'pathways',
    'intent_nodes',
    'doc_blocks'
  ],
  'public contains exactly the expected tables (six tenancy + four demo studio)'
);

-- ---------------------------------------------------------------------------
-- RLS enabled AND forced on every table (explicit per table, then a
-- future-proof sweep so a table added without RLS can never slip through)
-- ---------------------------------------------------------------------------

select ok((select relrowsecurity      from pg_class where oid = 'public.organizations'::regclass),        'organizations: RLS enabled');
select ok((select relforcerowsecurity from pg_class where oid = 'public.organizations'::regclass),        'organizations: RLS forced');
select ok((select relrowsecurity      from pg_class where oid = 'public.organization_members'::regclass), 'organization_members: RLS enabled');
select ok((select relforcerowsecurity from pg_class where oid = 'public.organization_members'::regclass), 'organization_members: RLS forced');
select ok((select relrowsecurity      from pg_class where oid = 'public.projects'::regclass),             'projects: RLS enabled');
select ok((select relforcerowsecurity from pg_class where oid = 'public.projects'::regclass),             'projects: RLS forced');
select ok((select relrowsecurity      from pg_class where oid = 'public.documents'::regclass),            'documents: RLS enabled');
select ok((select relforcerowsecurity from pg_class where oid = 'public.documents'::regclass),            'documents: RLS forced');
select ok((select relrowsecurity      from pg_class where oid = 'public.document_versions'::regclass),    'document_versions: RLS enabled');
select ok((select relforcerowsecurity from pg_class where oid = 'public.document_versions'::regclass),    'document_versions: RLS forced');
select ok((select relrowsecurity      from pg_class where oid = 'public.source_materials'::regclass),     'source_materials: RLS enabled');
select ok((select relforcerowsecurity from pg_class where oid = 'public.source_materials'::regclass),     'source_materials: RLS forced');

select is(
  (select count(*)::int
     from pg_class c
     join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind = 'r'
      and not c.relrowsecurity),
  0,
  'sweep: no public table lacks ENABLE ROW LEVEL SECURITY'
);

select is(
  (select count(*)::int
     from pg_class c
     join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind = 'r'
      and not c.relforcerowsecurity),
  0,
  'sweep: no public table lacks FORCE ROW LEVEL SECURITY'
);

-- ---------------------------------------------------------------------------
-- Complete, exactly-named policy sets per table
-- ---------------------------------------------------------------------------

select policies_are(
  'public', 'organizations',
  array['organizations_select', 'organizations_update'],
  'organizations: exactly the intended policies (INSERT and soft delete are RPC-only; no client DELETE policy)'
);

select policies_are(
  'public', 'organization_members',
  array[
    'organization_members_select',
    'organization_members_insert',
    'organization_members_update',
    'organization_members_delete'
  ],
  'organization_members: exactly the intended policies'
);

select policies_are(
  'public', 'projects',
  array['projects_select', 'projects_insert', 'projects_update_editor', 'projects_update_admin'],
  'projects: exactly the intended policies (split UPDATE gates soft delete to owner/admin; no client hard DELETE)'
);

select policies_are(
  'public', 'documents',
  array['documents_select', 'documents_insert', 'documents_update_editor', 'documents_update_admin'],
  'documents: exactly the intended policies (split UPDATE gates soft delete to owner/admin; no client hard DELETE)'
);

select policies_are(
  'public', 'document_versions',
  array['document_versions_select'],
  'document_versions: exactly the intended policies (append-only, server-path INSERT via create_document_version only)'
);

select policies_are(
  'public', 'source_materials',
  array['source_materials_select', 'source_materials_insert', 'source_materials_update_editor', 'source_materials_update_admin'],
  'source_materials: exactly the intended policies (split UPDATE gates soft delete to owner/admin; no client hard DELETE)'
);

-- ---------------------------------------------------------------------------
-- Append-only / RPC-only guarantees and policy role scoping
-- ---------------------------------------------------------------------------

select is_empty(
  $$select policyname from pg_policies
     where schemaname = 'public' and tablename = 'document_versions'
       and cmd in ('INSERT', 'UPDATE', 'DELETE', 'ALL')$$,
  'document_versions: append-only + server-path insert — no INSERT/UPDATE/DELETE/ALL policies exist'
);

select is_empty(
  $$select policyname from pg_policies
     where schemaname = 'public' and tablename = 'organizations'
       and cmd in ('INSERT', 'DELETE', 'ALL')$$,
  'organizations: creation is RPC-only and deletion is soft — no INSERT/DELETE/ALL policies exist'
);

select is_empty(
  $$select policyname from pg_policies
     where schemaname = 'public' and roles <> '{authenticated}'::name[]$$,
  'every policy is scoped TO authenticated (anon can match no policy)'
);

-- ---------------------------------------------------------------------------
-- Grant matrix (20260718000002_tenancy_grants.sql): explicit ACLs per role,
-- since the platform default no longer auto-exposes new tables
-- ---------------------------------------------------------------------------

select ok(
  has_table_privilege('authenticated', 'public.organizations', 'select')
  and has_table_privilege('authenticated', 'public.organizations', 'update')
  and not has_table_privilege('authenticated', 'public.organizations', 'insert')
  and not has_table_privilege('authenticated', 'public.organizations', 'delete'),
  'organizations: authenticated holds SELECT/UPDATE only (INSERT is RPC-only, DELETE is soft/server-side)'
);

select ok(
  has_table_privilege('authenticated', 'public.organization_members', 'select')
  and has_table_privilege('authenticated', 'public.organization_members', 'insert')
  and has_table_privilege('authenticated', 'public.organization_members', 'update')
  and has_table_privilege('authenticated', 'public.organization_members', 'delete'),
  'organization_members: authenticated holds full DML (RLS role-gates the rows)'
);

select ok(
  has_table_privilege('authenticated', 'public.projects', 'select')
  and has_table_privilege('authenticated', 'public.projects', 'insert')
  and has_table_privilege('authenticated', 'public.projects', 'update')
  and not has_table_privilege('authenticated', 'public.projects', 'delete'),
  'projects: authenticated holds SELECT/INSERT/UPDATE only (deletion is soft; hard DELETE is server-side)'
);

select ok(
  has_table_privilege('authenticated', 'public.documents', 'select')
  and has_table_privilege('authenticated', 'public.documents', 'insert')
  and has_table_privilege('authenticated', 'public.documents', 'update')
  and not has_table_privilege('authenticated', 'public.documents', 'delete'),
  'documents: authenticated holds SELECT/INSERT/UPDATE only (deletion is soft; hard DELETE is server-side)'
);

select ok(
  has_table_privilege('authenticated', 'public.document_versions', 'select')
  and not has_table_privilege('authenticated', 'public.document_versions', 'insert')
  and not has_table_privilege('authenticated', 'public.document_versions', 'update')
  and not has_table_privilege('authenticated', 'public.document_versions', 'delete'),
  'document_versions: authenticated holds SELECT only (append-only, INSERT via create_document_version RPC only)'
);

select ok(
  has_table_privilege('authenticated', 'public.source_materials', 'select')
  and has_table_privilege('authenticated', 'public.source_materials', 'insert')
  and has_table_privilege('authenticated', 'public.source_materials', 'update')
  and not has_table_privilege('authenticated', 'public.source_materials', 'delete'),
  'source_materials: authenticated holds SELECT/INSERT/UPDATE only (deletion is soft; hard DELETE is server-side)'
);

select ok(
  (select bool_and(
       has_table_privilege('anon', c.oid, 'select')
       and not has_table_privilege('anon', c.oid, 'insert')
       and not has_table_privilege('anon', c.oid, 'update')
       and not has_table_privilege('anon', c.oid, 'delete'))
     from pg_class c
     join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r'),
  'anon: SELECT-only grants on every public table (policies TO authenticated yield zero rows)'
);

select ok(
  (select bool_and(
       has_table_privilege('service_role', c.oid, 'select')
       and has_table_privilege('service_role', c.oid, 'insert')
       and has_table_privilege('service_role', c.oid, 'update')
       and has_table_privilege('service_role', c.oid, 'delete'))
     from pg_class c
     join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r'),
  'service_role: full DML on every public table (BYPASSRLS skips policies, not ACLs)'
);

select ok(
  (select bool_and(
       not has_table_privilege('anon', c.oid, 'truncate')
       and not has_table_privilege('authenticated', c.oid, 'truncate'))
     from pg_class c
     join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r'),
  'client roles hold no TRUNCATE on any public table (TRUNCATE is not subject to RLS)'
);

-- ---------------------------------------------------------------------------
-- Role enum matches docs/data-model.md §3 organization_members
-- ---------------------------------------------------------------------------

select enum_has_labels(
  'public', 'org_role',
  array['owner', 'admin', 'editor', 'reviewer', 'viewer'],
  'org_role enum carries exactly the data-model role set'
);

-- ---------------------------------------------------------------------------
-- Security-definer helpers: exist, in app_private, definer-mode
-- ---------------------------------------------------------------------------

select has_function('app_private', 'is_org_member', array['uuid'],
  'app_private.is_org_member(uuid) exists');
select is_definer('app_private', 'is_org_member', array['uuid'],
  'app_private.is_org_member(uuid) is SECURITY DEFINER');
select has_function('app_private', 'has_org_role', array['uuid', 'text[]'],
  'app_private.has_org_role(uuid, text[]) exists');
select is_definer('app_private', 'has_org_role', array['uuid', 'text[]'],
  'app_private.has_org_role(uuid, text[]) is SECURITY DEFINER');
select has_function('public', 'create_organization', array['text'],
  'public.create_organization(text) exists');
select is_definer('public', 'create_organization', array['text'],
  'public.create_organization(text) is SECURITY DEFINER');
select has_function('public', 'create_document_version', array['uuid', 'jsonb'],
  'public.create_document_version(uuid, jsonb) exists');
select is_definer('public', 'create_document_version', array['uuid', 'jsonb'],
  'public.create_document_version(uuid, jsonb) is SECURITY DEFINER');
select has_function('public', 'soft_delete_organization', array['uuid'],
  'public.soft_delete_organization(uuid) exists');
select is_definer('public', 'soft_delete_organization', array['uuid'],
  'public.soft_delete_organization(uuid) is SECURITY DEFINER');

-- ---------------------------------------------------------------------------
-- Privilege lockdown: app_private unreachable by anon; EXECUTE grants minimal
-- ---------------------------------------------------------------------------

select ok(not has_schema_privilege('anon', 'app_private', 'usage'),
  'anon has no USAGE on app_private');
select ok(has_schema_privilege('authenticated', 'app_private', 'usage'),
  'authenticated has USAGE on app_private (required for policy evaluation)');
select ok(not has_function_privilege('anon', 'public.create_organization(text)', 'execute'),
  'anon cannot execute create_organization');
select ok(has_function_privilege('authenticated', 'public.create_organization(text)', 'execute'),
  'authenticated can execute create_organization');
select ok(not has_function_privilege('anon', 'app_private.is_org_member(uuid)', 'execute'),
  'anon cannot execute is_org_member');
select ok(has_function_privilege('authenticated', 'app_private.is_org_member(uuid)', 'execute'),
  'authenticated can execute is_org_member');
select ok(not has_function_privilege('anon', 'app_private.has_org_role(uuid, text[])', 'execute'),
  'anon cannot execute has_org_role');
select ok(has_function_privilege('authenticated', 'app_private.has_org_role(uuid, text[])', 'execute'),
  'authenticated can execute has_org_role');
select ok(not has_function_privilege('anon', 'public.create_document_version(uuid, jsonb)', 'execute'),
  'anon cannot execute create_document_version');
select ok(has_function_privilege('authenticated', 'public.create_document_version(uuid, jsonb)', 'execute'),
  'authenticated can execute create_document_version');
select ok(not has_function_privilege('anon', 'public.soft_delete_organization(uuid)', 'execute'),
  'anon cannot execute soft_delete_organization');
select ok(has_function_privilege('authenticated', 'public.soft_delete_organization(uuid)', 'execute'),
  'authenticated can execute soft_delete_organization (owner gate is inside the function)');
select ok(
  not has_function_privilege('anon', 'app_private.set_updated_at()', 'execute')
  and not has_function_privilege('authenticated', 'app_private.set_updated_at()', 'execute'),
  'set_updated_at is not directly executable by client roles'
);
select ok(
  not has_function_privilege('anon', 'app_private.enforce_immutable_columns()', 'execute')
  and not has_function_privilege('authenticated', 'app_private.enforce_immutable_columns()', 'execute')
  and not has_function_privilege('anon', 'app_private.protect_last_owner()', 'execute')
  and not has_function_privilege('authenticated', 'app_private.protect_last_owner()', 'execute'),
  'enforce_immutable_columns / protect_last_owner are not directly executable by client roles'
);

select * from finish();

rollback;
