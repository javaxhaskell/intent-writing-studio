-- ============================================================================
-- 002_tenancy_isolation.sql — cross-tenant denial on EVERY table
--
-- Verifies docs/security.md T1 (cross-tenant data access) against
-- supabase/migrations/20260718000001_tenancy.sql: a member of Org Alpha must
-- not be able to SELECT / INSERT / UPDATE / DELETE Org Beta rows on any of the
-- six tenancy tables, and the anon role must see nothing at all.
--
-- Technique: fixtures with fixed UUIDs are created inside this transaction
-- (no dependency on supabase/seed.sql) and rolled back at the end. Users are
-- simulated with SET LOCAL role authenticated + SET LOCAL request.jwt.claims;
-- pg_temp.impersonate() wraps both via set_config(..., is_local => true),
-- which is the function form of SET LOCAL.
--
-- Denial semantics under RLS + the explicit grant matrix
-- (20260718000002_tenancy_grants.sql):
--   * INSERT: WITH CHECK violation (or missing grant) raises SQLSTATE 42501;
--   * UPDATE where authenticated holds the grant: the USING clause hides the
--     row, so the statement affects 0 rows — asserted by verifying the row
--     is unchanged afterwards as the privileged role;
--   * DELETE on projects/documents/source_materials/organizations and
--     INSERT/UPDATE/DELETE on document_versions: the grant itself is
--     withheld (deletion is soft; snapshots are server-path only), so the
--     attempt raises 42501 outright for ANY authenticated user;
--   * tenancy keys (organization_id, parent ids) are frozen by trigger, so a
--     cross-tenant re-parent raises 42501 even for privileged roles;
--   * soft-deleting an organization revokes the whole subtree: the RLS
--     helpers require the org to be live, pinning the security decision that
--     a "deleted" tenant's content is inaccessible during the retention
--     window (not merely at purge).
--
-- Fixture slugs are pgtap-002-* so the suite also runs against a database
-- that has been seeded with supabase/seed.sql (org-alpha / org-beta exist
-- there; slugs are UNIQUE).
--
-- Run with: supabase test db
-- ============================================================================

begin;

create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;

select plan(49);

-- ---------------------------------------------------------------------------
-- Fixtures: two tenants, one owner each, one row per table per tenant
-- ---------------------------------------------------------------------------

insert into auth.users (id, email) values
  ('11111111-1111-4111-8111-111111111111', 'alpha-owner@rls.test'),
  ('22222222-2222-4222-8222-222222222222', 'beta-owner@rls.test');

insert into public.organizations (id, name, slug) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Org Alpha', 'pgtap-002-alpha'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'Org Beta',  'pgtap-002-beta');

insert into public.organization_members (id, organization_id, user_id, role) values
  ('aaaaaaaa-0000-4000-8000-000000000005', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
   '11111111-1111-4111-8111-111111111111', 'owner'),
  ('bbbbbbbb-0000-4000-8000-000000000005', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
   '22222222-2222-4222-8222-222222222222', 'owner');

insert into public.projects (id, organization_id, name) values
  ('aaaaaaaa-0000-4000-8000-000000000001', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Alpha Project'),
  ('bbbbbbbb-0000-4000-8000-000000000001', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'Beta Project');

insert into public.documents (id, project_id, organization_id, title) values
  ('aaaaaaaa-0000-4000-8000-000000000002', 'aaaaaaaa-0000-4000-8000-000000000001',
   'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Alpha Doc'),
  ('bbbbbbbb-0000-4000-8000-000000000002', 'bbbbbbbb-0000-4000-8000-000000000001',
   'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'Beta Doc');

insert into public.document_versions (id, document_id, organization_id, content, content_hash, created_by) values
  ('aaaaaaaa-0000-4000-8000-000000000003', 'aaaaaaaa-0000-4000-8000-000000000002',
   'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '{"v": 1}', 'hash-alpha-1',
   '11111111-1111-4111-8111-111111111111'),
  ('bbbbbbbb-0000-4000-8000-000000000003', 'bbbbbbbb-0000-4000-8000-000000000002',
   'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', '{"v": 1}', 'hash-beta-1',
   '22222222-2222-4222-8222-222222222222');

insert into public.source_materials (id, project_id, organization_id, storage_path, mime_type) values
  ('aaaaaaaa-0000-4000-8000-000000000004', 'aaaaaaaa-0000-4000-8000-000000000001',
   'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'org-alpha/brief.pdf', 'application/pdf'),
  ('bbbbbbbb-0000-4000-8000-000000000004', 'bbbbbbbb-0000-4000-8000-000000000001',
   'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'org-beta/brief.pdf', 'application/pdf');

create function pg_temp.impersonate(user_id uuid) returns void
language plpgsql
as $fn$
begin
  -- set_config(..., is_local => true) == SET LOCAL: reverts at COMMIT/ROLLBACK.
  perform set_config('request.jwt.claims',
                     json_build_object('sub', user_id, 'role', 'authenticated')::text,
                     true);
  perform set_config('role', 'authenticated', true);
end;
$fn$;

-- ---------------------------------------------------------------------------
-- SELECT scoping: Alpha's member sees exactly Alpha's rows on every table
-- (simultaneously the positive control that impersonation works, and the
-- cross-tenant SELECT denial — Beta rows are absent from every result)
-- ---------------------------------------------------------------------------

select pg_temp.impersonate('11111111-1111-4111-8111-111111111111');

select results_eq(
  $$select id from public.organizations order by id$$,
  array['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid],
  'organizations: Alpha member sees exactly Org Alpha — Org Beta invisible'
);

select results_eq(
  $$select organization_id from public.organization_members order by organization_id$$,
  array['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid],
  'organization_members: Alpha member sees only Alpha memberships — Beta''s invisible'
);

select results_eq(
  $$select id from public.projects order by id$$,
  array['aaaaaaaa-0000-4000-8000-000000000001'::uuid],
  'projects: Alpha member sees only Alpha''s project — Beta''s invisible'
);

select results_eq(
  $$select id from public.documents order by id$$,
  array['aaaaaaaa-0000-4000-8000-000000000002'::uuid],
  'documents: Alpha member sees only Alpha''s document — Beta''s invisible'
);

select results_eq(
  $$select id from public.document_versions order by id$$,
  array['aaaaaaaa-0000-4000-8000-000000000003'::uuid],
  'document_versions: Alpha member sees only Alpha''s version — Beta''s invisible'
);

select results_eq(
  $$select id from public.source_materials order by id$$,
  array['aaaaaaaa-0000-4000-8000-000000000004'::uuid],
  'source_materials: Alpha member sees only Alpha''s material — Beta''s invisible'
);

-- Symmetry smoke check from the other tenant.

select pg_temp.impersonate('22222222-2222-4222-8222-222222222222');

select results_eq(
  $$select id from public.organizations order by id$$,
  array['bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'::uuid],
  'organizations: Beta member sees exactly Org Beta — isolation is symmetric'
);

-- ---------------------------------------------------------------------------
-- Cross-tenant INSERT denial: Alpha member writing into Org Beta (every table)
-- ---------------------------------------------------------------------------

select pg_temp.impersonate('11111111-1111-4111-8111-111111111111');

select throws_ok(
  $$insert into public.organizations (name, slug) values ('Rogue Org', 'rogue-org')$$,
  '42501', null,
  'organizations: direct INSERT denied (creation is RPC-only)'
);

select throws_ok(
  $$insert into public.organization_members (organization_id, user_id, role)
    values ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', '11111111-1111-4111-8111-111111111111', 'viewer')$$,
  '42501', null,
  'organization_members: Alpha member cannot add themself to Org Beta'
);

select throws_ok(
  $$insert into public.projects (organization_id, name)
    values ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'Injected Project')$$,
  '42501', null,
  'projects: Alpha member cannot insert into Org Beta'
);

select throws_ok(
  $$insert into public.documents (project_id, organization_id, title)
    values ('bbbbbbbb-0000-4000-8000-000000000001', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'Injected Doc')$$,
  '42501', null,
  'documents: Alpha member cannot insert into Org Beta'
);

select throws_ok(
  $$insert into public.document_versions (document_id, organization_id, content, content_hash, created_by)
    values ('bbbbbbbb-0000-4000-8000-000000000002', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
            '{"v": 99}', 'hash-injected', '11111111-1111-4111-8111-111111111111')$$,
  '42501', null,
  'document_versions: Alpha member cannot insert into Org Beta'
);

select throws_ok(
  $$insert into public.source_materials (project_id, organization_id, storage_path, mime_type)
    values ('bbbbbbbb-0000-4000-8000-000000000001', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
            'org-beta/injected.pdf', 'application/pdf')$$,
  '42501', null,
  'source_materials: Alpha member cannot insert into Org Beta'
);

-- Spoofed denormalized organization_id: own project, foreign org — the RLS
-- WITH CHECK gate fires before any constraint.

select throws_ok(
  $$insert into public.documents (project_id, organization_id, title)
    values ('aaaaaaaa-0000-4000-8000-000000000001', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'Spoofed Org Doc')$$,
  '42501', null,
  'documents: organization_id spoofed to Org Beta on an Alpha project is denied by RLS'
);

-- Reverse spoof: foreign project, own org — RLS passes but the composite FK
-- (project_id, organization_id) keeps denormalization honest.

select throws_ok(
  $$insert into public.documents (project_id, organization_id, title)
    values ('bbbbbbbb-0000-4000-8000-000000000001', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Spoofed Project Doc')$$,
  '23503', null,
  'documents: Beta project cannot be claimed under Org Alpha (composite FK enforces denormalization)'
);

-- ---------------------------------------------------------------------------
-- Cross-tenant UPDATE denial: statements silently affect 0 rows where the
-- grant exists; document_versions has no client UPDATE grant at all
-- ---------------------------------------------------------------------------

update public.organizations set name = 'Pwned by Alpha'
  where id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
update public.organization_members set role = 'viewer'
  where id = 'bbbbbbbb-0000-4000-8000-000000000005';
update public.projects set name = 'Pwned by Alpha'
  where id = 'bbbbbbbb-0000-4000-8000-000000000001';
update public.documents set title = 'Pwned by Alpha'
  where id = 'bbbbbbbb-0000-4000-8000-000000000002';
update public.source_materials set injection_scan_status = 'passed'
  where id = 'bbbbbbbb-0000-4000-8000-000000000004';

select throws_ok(
  $$update public.document_versions set content_hash = 'pwned'
     where id = 'bbbbbbbb-0000-4000-8000-000000000003'$$,
  '42501', null,
  'document_versions: client UPDATE denied outright (append-only, no grant)'
);

reset role;

select is(
  (select name from public.organizations where id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'),
  'Org Beta'::text,
  'organizations: cross-tenant UPDATE had no effect'
);

select is(
  (select role::text from public.organization_members where id = 'bbbbbbbb-0000-4000-8000-000000000005'),
  'owner',
  'organization_members: cross-tenant UPDATE had no effect'
);

select is(
  (select name from public.projects where id = 'bbbbbbbb-0000-4000-8000-000000000001'),
  'Beta Project'::text,
  'projects: cross-tenant UPDATE had no effect'
);

select is(
  (select title from public.documents where id = 'bbbbbbbb-0000-4000-8000-000000000002'),
  'Beta Doc'::text,
  'documents: cross-tenant UPDATE had no effect'
);

select is(
  (select injection_scan_status from public.source_materials where id = 'bbbbbbbb-0000-4000-8000-000000000004'),
  'pending'::text,
  'source_materials: cross-tenant UPDATE had no effect'
);

-- ---------------------------------------------------------------------------
-- Cross-tenant DELETE denial. organization_members (grant exists) silently
-- affects 0 rows; every other table withholds the client DELETE grant
-- entirely (deletion is soft via UPDATE deleted_at; hard delete is the purge
-- job), so the attempts raise 42501 outright.
-- ---------------------------------------------------------------------------

select pg_temp.impersonate('11111111-1111-4111-8111-111111111111');

delete from public.organization_members where id = 'bbbbbbbb-0000-4000-8000-000000000005';

select throws_ok(
  $$delete from public.source_materials where id = 'bbbbbbbb-0000-4000-8000-000000000004'$$,
  '42501', null,
  'source_materials: client hard DELETE denied outright (soft delete only; purge is server-side)'
);

select throws_ok(
  $$delete from public.documents where id = 'bbbbbbbb-0000-4000-8000-000000000002'$$,
  '42501', null,
  'documents: client hard DELETE denied outright (soft delete only; purge is server-side)'
);

select throws_ok(
  $$delete from public.projects where id = 'bbbbbbbb-0000-4000-8000-000000000001'$$,
  '42501', null,
  'projects: client hard DELETE denied outright (soft delete only; purge is server-side)'
);

select throws_ok(
  $$delete from public.document_versions where id = 'bbbbbbbb-0000-4000-8000-000000000003'$$,
  '42501', null,
  'document_versions: client DELETE denied outright (append-only, no grant)'
);

select throws_ok(
  $$delete from public.organizations where id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'$$,
  '42501', null,
  'organizations: client DELETE denied outright (soft delete via public.soft_delete_organization only)'
);

reset role;

select is(
  (select count(*)::int from public.organization_members where id = 'bbbbbbbb-0000-4000-8000-000000000005'),
  1, 'organization_members: cross-tenant DELETE had no effect'
);

select is(
  (select count(*)::int from public.projects where id = 'bbbbbbbb-0000-4000-8000-000000000001'),
  1, 'projects: cross-tenant DELETE had no effect'
);

select is(
  (select count(*)::int from public.documents where id = 'bbbbbbbb-0000-4000-8000-000000000002'),
  1, 'documents: cross-tenant DELETE had no effect'
);

select is(
  (select count(*)::int from public.source_materials where id = 'bbbbbbbb-0000-4000-8000-000000000004'),
  1, 'source_materials: cross-tenant DELETE had no effect'
);

-- ---------------------------------------------------------------------------
-- Tenancy keys are frozen after insert: a cross-org re-parent UPDATE fails
-- in the trigger layer (RLS WITH CHECK cannot see the OLD row, so a user
-- with editor+ roles in two orgs could otherwise move Org A's rows into
-- Org B). Run as the privileged role: the trigger binds every role.
-- ---------------------------------------------------------------------------

select throws_ok(
  $$update public.projects
       set organization_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
     where id = 'aaaaaaaa-0000-4000-8000-000000000001'$$,
  '42501', null,
  'projects: organization_id is immutable — cross-org re-parent rejected by trigger'
);

select throws_ok(
  $$update public.documents
       set organization_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
           project_id      = 'bbbbbbbb-0000-4000-8000-000000000001'
     where id = 'aaaaaaaa-0000-4000-8000-000000000002'$$,
  '42501', null,
  'documents: organization_id/project_id are immutable — cross-org re-parent rejected by trigger'
);

select throws_ok(
  $$update public.source_materials
       set organization_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
           project_id      = 'bbbbbbbb-0000-4000-8000-000000000001'
     where id = 'aaaaaaaa-0000-4000-8000-000000000004'$$,
  '42501', null,
  'source_materials: organization_id/project_id are immutable — cross-org re-parent rejected by trigger'
);

-- ---------------------------------------------------------------------------
-- anon sees nothing (all policies are TO authenticated; forced RLS denies)
-- ---------------------------------------------------------------------------

select set_config('request.jwt.claims', '{"role": "anon"}', true);
select set_config('role', 'anon', true);

select is_empty($$select id from public.organizations$$,        'anon sees no organizations');
select is_empty($$select id from public.organization_members$$, 'anon sees no organization_members');
select is_empty($$select id from public.projects$$,             'anon sees no projects');
select is_empty($$select id from public.documents$$,            'anon sees no documents');
select is_empty($$select id from public.document_versions$$,    'anon sees no document_versions');
select is_empty($$select id from public.source_materials$$,     'anon sees no source_materials');

select throws_ok(
  $$insert into public.organizations (name, slug) values ('Anon Org', 'anon-org')$$,
  '42501', null,
  'anon cannot insert organizations'
);

select throws_ok(
  $$insert into public.documents (project_id, organization_id, title)
    values ('aaaaaaaa-0000-4000-8000-000000000001', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Anon Doc')$$,
  '42501', null,
  'anon cannot insert documents'
);

reset role;

-- ---------------------------------------------------------------------------
-- Soft-deleting an organization hides and freezes its ENTIRE subtree for
-- every member during the retention window (security.md A4/A5): the RLS
-- helpers require the org to be live. Only the server-side purge job (which
-- bypasses RLS) can touch a soft-deleted tenant.
-- ---------------------------------------------------------------------------

select pg_temp.impersonate('11111111-1111-4111-8111-111111111111');

select lives_ok(
  $$select public.soft_delete_organization('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')$$,
  'soft delete: the owner can soft-delete their organization via the RPC'
);

select is_empty($$select id from public.organizations$$,
  'soft-deleted org: the organization row is hidden from its own members');
select is_empty($$select id from public.organization_members$$,
  'soft-deleted org: membership rows are hidden');
select is_empty($$select id from public.projects$$,
  'soft-deleted org: projects are hidden');
select is_empty($$select id from public.documents$$,
  'soft-deleted org: documents are hidden');
select is_empty($$select id from public.document_versions$$,
  'soft-deleted org: document versions are hidden');
select is_empty($$select id from public.source_materials$$,
  'soft-deleted org: source materials are hidden');

select throws_ok(
  $$insert into public.projects (organization_id, name)
    values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Necro Project')$$,
  '42501', null,
  'soft-deleted org: writes into the deleted tenant are denied'
);

reset role;

select * from finish();

rollback;
