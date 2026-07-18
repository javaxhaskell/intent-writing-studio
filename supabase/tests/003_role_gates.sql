-- ============================================================================
-- 003_role_gates.sql — role-gated writes, owner protection, and the RPCs
--
-- Verifies docs/data-model.md §2/§3 role gates against
-- supabase/migrations/20260718000001_tenancy.sql:
--   * viewer (and reviewer) cannot write anything;
--   * editor can write content (projects, documents, source_materials, and
--     document snapshots via the create_document_version RPC) but cannot
--     touch memberships, the organization row, hard-delete anything, or
--     soft-delete containers;
--   * only owner/admin manage members and update the organization;
--   * owner-role membership rows are protected from admins: an admin cannot
--     promote themself (or anyone) to owner, nor demote/remove an owner;
--   * the last-owner guard rejects demoting or deleting an organization's
--     final owner;
--   * soft delete (UPDATE deleted_at) is role-gated as deletion —
--     owner/admin only — and admins can restore; organization soft delete is
--     RPC-only (public.soft_delete_organization) and owner-only;
--   * document_versions is append-only and server-path-insert-only even for
--     the owner (INSERT goes through public.create_document_version, which
--     derives created_by and content_hash server-side);
--   * public.create_organization() creates org + owner membership atomically,
--     and a second user cannot see, join, alter, or otherwise hijack it.
--
-- Fixtures are created inside this transaction (no dependency on seed.sql)
-- and rolled back at the end. Users are simulated with SET LOCAL role
-- authenticated + SET LOCAL request.jwt.claims (pg_temp.impersonate wraps
-- both via set_config(..., is_local => true)).
--
-- Run with: supabase test db
-- ============================================================================

begin;

create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;

select plan(70);

-- ---------------------------------------------------------------------------
-- Fixtures: one org with every role represented, plus outsiders for the RPC
-- ---------------------------------------------------------------------------

insert into auth.users (id, email) values
  ('33333333-0000-4000-8000-000000000001', 'gamma-owner@rls.test'),
  ('33333333-0000-4000-8000-000000000002', 'gamma-admin@rls.test'),
  ('33333333-0000-4000-8000-000000000003', 'gamma-editor@rls.test'),
  ('33333333-0000-4000-8000-000000000004', 'gamma-reviewer@rls.test'),
  ('33333333-0000-4000-8000-000000000005', 'gamma-viewer@rls.test'),
  ('33333333-0000-4000-8000-000000000006', 'gamma-disposable@rls.test'),
  ('33333333-0000-4000-8000-000000000007', 'gamma-invitee@rls.test'),
  ('33333333-0000-4000-8000-000000000008', 'gamma-invitee2@rls.test'),
  ('33333333-0000-4000-8000-000000000009', 'outsider@rls.test');

-- Slug is pgtap-003-* so the suite also runs against a seeded database
-- (supabase/seed.sql occupies org-alpha / org-beta; slugs are UNIQUE).
insert into public.organizations (id, name, slug) values
  ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'Org Gamma', 'pgtap-003-gamma');

insert into public.organization_members (id, organization_id, user_id, role) values
  ('cccccccc-0000-4000-8000-000000000201', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
   '33333333-0000-4000-8000-000000000001', 'owner'),
  ('cccccccc-0000-4000-8000-000000000202', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
   '33333333-0000-4000-8000-000000000002', 'admin'),
  ('cccccccc-0000-4000-8000-000000000203', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
   '33333333-0000-4000-8000-000000000003', 'editor'),
  ('cccccccc-0000-4000-8000-000000000204', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
   '33333333-0000-4000-8000-000000000004', 'reviewer'),
  ('cccccccc-0000-4000-8000-000000000205', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
   '33333333-0000-4000-8000-000000000005', 'viewer'),
  ('cccccccc-0000-4000-8000-000000000206', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
   '33333333-0000-4000-8000-000000000006', 'viewer');

insert into public.projects (id, organization_id, name) values
  ('cccccccc-0000-4000-8000-000000000301', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'Gamma Project');

insert into public.documents (id, project_id, organization_id, title) values
  ('cccccccc-0000-4000-8000-000000000302', 'cccccccc-0000-4000-8000-000000000301',
   'cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'Gamma Doc');

insert into public.document_versions (id, document_id, organization_id, content, content_hash, created_by) values
  ('cccccccc-0000-4000-8000-000000000303', 'cccccccc-0000-4000-8000-000000000302',
   'cccccccc-cccc-4ccc-8ccc-cccccccccccc', '{"v": 1}', 'hash-gamma-1',
   '33333333-0000-4000-8000-000000000003');

insert into public.source_materials (id, project_id, organization_id, storage_path, mime_type) values
  ('cccccccc-0000-4000-8000-000000000304', 'cccccccc-0000-4000-8000-000000000301',
   'cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'org-gamma/brief.pdf', 'application/pdf');

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
-- Harness smoke check
-- ---------------------------------------------------------------------------

select pg_temp.impersonate('33333333-0000-4000-8000-000000000001');

select results_eq(
  $$select id from public.organizations order by id$$,
  array['cccccccc-cccc-4ccc-8ccc-cccccccccccc'::uuid],
  'smoke: impersonated owner sees Org Gamma'
);

-- ---------------------------------------------------------------------------
-- viewer: cannot write anything
-- ---------------------------------------------------------------------------

select pg_temp.impersonate('33333333-0000-4000-8000-000000000005');

select throws_ok(
  $$insert into public.projects (organization_id, name)
    values ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'Viewer Project')$$,
  '42501', null,
  'viewer cannot insert projects'
);

select throws_ok(
  $$insert into public.documents (project_id, organization_id, title)
    values ('cccccccc-0000-4000-8000-000000000301', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'Viewer Doc')$$,
  '42501', null,
  'viewer cannot insert documents'
);

select throws_ok(
  $$insert into public.document_versions (document_id, organization_id, content, content_hash, created_by)
    values ('cccccccc-0000-4000-8000-000000000302', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
            '{"v": 9}', 'hash-viewer', '33333333-0000-4000-8000-000000000005')$$,
  '42501', null,
  'viewer cannot insert document_versions directly (no client INSERT path)'
);

select throws_ok(
  $$insert into public.source_materials (project_id, organization_id, storage_path, mime_type)
    values ('cccccccc-0000-4000-8000-000000000301', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
            'org-gamma/viewer.pdf', 'application/pdf')$$,
  '42501', null,
  'viewer cannot insert source_materials'
);

select throws_ok(
  $$insert into public.organization_members (organization_id, user_id, role)
    values ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', '33333333-0000-4000-8000-000000000007', 'viewer')$$,
  '42501', null,
  'viewer cannot insert memberships'
);

update public.documents set title = 'Viewer Was Here'
  where id = 'cccccccc-0000-4000-8000-000000000302';
update public.organization_members set role = 'owner'
  where id = 'cccccccc-0000-4000-8000-000000000205';
update public.organizations set name = 'Viewer Org'
  where id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

select throws_ok(
  $$delete from public.documents
     where id = 'cccccccc-0000-4000-8000-000000000302'$$,
  '42501', null,
  'viewer cannot hard-DELETE documents (no client DELETE grant exists at all)'
);

reset role;

select is(
  (select title from public.documents where id = 'cccccccc-0000-4000-8000-000000000302'),
  'Gamma Doc'::text,
  'viewer UPDATE on documents had no effect'
);

select is(
  (select role::text from public.organization_members where id = 'cccccccc-0000-4000-8000-000000000205'),
  'viewer',
  'viewer cannot escalate their own role'
);

select is(
  (select name from public.organizations where id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'),
  'Org Gamma'::text,
  'viewer UPDATE on organizations had no effect'
);

-- ---------------------------------------------------------------------------
-- reviewer: also read-only for content writes
-- ---------------------------------------------------------------------------

select pg_temp.impersonate('33333333-0000-4000-8000-000000000004');

select throws_ok(
  $$insert into public.documents (project_id, organization_id, title)
    values ('cccccccc-0000-4000-8000-000000000301', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'Reviewer Doc')$$,
  '42501', null,
  'reviewer cannot insert documents'
);

update public.documents set title = 'Reviewer Was Here'
  where id = 'cccccccc-0000-4000-8000-000000000302';

reset role;

select is(
  (select title from public.documents where id = 'cccccccc-0000-4000-8000-000000000302'),
  'Gamma Doc'::text,
  'reviewer UPDATE on documents had no effect'
);

-- ---------------------------------------------------------------------------
-- editor: can write content, cannot touch memberships / org / any hard delete
-- ---------------------------------------------------------------------------

select pg_temp.impersonate('33333333-0000-4000-8000-000000000003');

select lives_ok(
  $$insert into public.projects (organization_id, name)
    values ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'Editor Project')$$,
  'editor can insert projects'
);

select lives_ok(
  $$insert into public.documents (project_id, organization_id, title)
    values ('cccccccc-0000-4000-8000-000000000301', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'Editor Doc')$$,
  'editor can insert documents'
);

select lives_ok(
  $$insert into public.source_materials (project_id, organization_id, storage_path, mime_type)
    values ('cccccccc-0000-4000-8000-000000000301', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
            'org-gamma/editor.pdf', 'application/pdf')$$,
  'editor can insert source_materials'
);

select throws_ok(
  $$insert into public.organization_members (organization_id, user_id, role)
    values ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', '33333333-0000-4000-8000-000000000007', 'viewer')$$,
  '42501', null,
  'editor cannot insert memberships'
);

update public.documents set title = 'Edited by editor'
  where id = 'cccccccc-0000-4000-8000-000000000302';
update public.organization_members set role = 'admin'
  where id = 'cccccccc-0000-4000-8000-000000000203';
delete from public.organization_members
  where id = 'cccccccc-0000-4000-8000-000000000205';
update public.organizations set name = 'Editor Org'
  where id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

select throws_ok(
  $$delete from public.projects
     where id = 'cccccccc-0000-4000-8000-000000000301'$$,
  '42501', null,
  'editor cannot hard-DELETE projects (no client DELETE grant exists at all)'
);

reset role;

select is(
  (select title from public.documents where id = 'cccccccc-0000-4000-8000-000000000302'),
  'Edited by editor'::text,
  'editor UPDATE on documents succeeded'
);

select is(
  (select role::text from public.organization_members where id = 'cccccccc-0000-4000-8000-000000000203'),
  'editor',
  'editor cannot escalate their own role'
);

select is(
  (select count(*)::int from public.organization_members where id = 'cccccccc-0000-4000-8000-000000000205'),
  1, 'editor DELETE on memberships had no effect'
);

select is(
  (select name from public.organizations where id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'),
  'Org Gamma'::text,
  'editor UPDATE on organizations had no effect'
);

select is(
  (select count(*)::int from public.projects where id = 'cccccccc-0000-4000-8000-000000000301'),
  1, 'project still present after editor hard-DELETE attempt'
);

-- ---------------------------------------------------------------------------
-- document snapshots: server path only (public.create_document_version).
-- The RPC derives created_by and content_hash server-side; direct INSERT is
-- denied outright for every client role (data-model §3: INSERT server-side
-- only).
-- ---------------------------------------------------------------------------

select pg_temp.impersonate('33333333-0000-4000-8000-000000000003');

select lives_ok(
  $$select public.create_document_version(
      'cccccccc-0000-4000-8000-000000000302'::uuid,
      '{"v": 2, "via": "rpc"}'::jsonb)$$,
  'RPC: editor can create a document version'
);

select throws_ok(
  $$insert into public.document_versions (document_id, organization_id, content, content_hash, created_by)
    values ('cccccccc-0000-4000-8000-000000000302', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
            '{"v": 3}', 'hash-forged', '33333333-0000-4000-8000-000000000003')$$,
  '42501', null,
  'editor cannot INSERT document_versions directly (server path only — forged hashes impossible)'
);

select throws_ok(
  $$select public.create_document_version(
      'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'::uuid, '{"v": 1}'::jsonb)$$,
  '42501', null,
  'RPC: nonexistent document is indistinguishable from unauthorized (no existence oracle)'
);

reset role;

select is(
  (select created_by from public.document_versions
    where document_id = 'cccccccc-0000-4000-8000-000000000302'
      and content @> '{"via": "rpc"}'),
  '33333333-0000-4000-8000-000000000003'::uuid,
  'RPC: created_by is derived from auth.uid(), not client input'
);

select is(
  (select content_hash from public.document_versions
    where document_id = 'cccccccc-0000-4000-8000-000000000302'
      and content @> '{"via": "rpc"}'),
  encode(sha256(convert_to('{"v": 2, "via": "rpc"}'::jsonb::text, 'UTF8')), 'hex'),
  'RPC: content_hash is computed server-side from the stored content'
);

select pg_temp.impersonate('33333333-0000-4000-8000-000000000005');

select throws_ok(
  $$select public.create_document_version(
      'cccccccc-0000-4000-8000-000000000302'::uuid, '{"v": 9}'::jsonb)$$,
  '42501', null,
  'RPC: viewer cannot create document versions (role-gated to owner/admin/editor)'
);

reset role;

-- ---------------------------------------------------------------------------
-- owner/admin: manage members and the organization
-- ---------------------------------------------------------------------------

select pg_temp.impersonate('33333333-0000-4000-8000-000000000002');

select lives_ok(
  $$insert into public.organization_members (organization_id, user_id, role)
    values ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', '33333333-0000-4000-8000-000000000007', 'viewer')$$,
  'admin can add members'
);

update public.organization_members set role = 'reviewer'
  where id = 'cccccccc-0000-4000-8000-000000000205';
delete from public.organization_members
  where id = 'cccccccc-0000-4000-8000-000000000206';

reset role;

select is(
  (select count(*)::int from public.organization_members
    where organization_id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
      and user_id = '33333333-0000-4000-8000-000000000007'),
  1, 'admin''s invited member row exists'
);

select is(
  (select role::text from public.organization_members where id = 'cccccccc-0000-4000-8000-000000000205'),
  'reviewer',
  'admin can change a member''s role'
);

select is(
  (select count(*)::int from public.organization_members where id = 'cccccccc-0000-4000-8000-000000000206'),
  0, 'admin can remove a member'
);

select pg_temp.impersonate('33333333-0000-4000-8000-000000000001');

select lives_ok(
  $$insert into public.organization_members (organization_id, user_id, role)
    values ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', '33333333-0000-4000-8000-000000000008', 'editor')$$,
  'owner can add members'
);

update public.organizations set name = 'Org Gamma Renamed'
  where id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

reset role;

select is(
  (select name from public.organizations where id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'),
  'Org Gamma Renamed'::text,
  'owner can update the organization'
);

select pg_temp.impersonate('33333333-0000-4000-8000-000000000002');

update public.organizations set name = 'Org Gamma Again'
  where id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

reset role;

select is(
  (select name from public.organizations where id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'),
  'Org Gamma Again'::text,
  'admin can update the organization'
);

-- ---------------------------------------------------------------------------
-- owner-role rows are protected from admins: only owners may create, modify,
-- or remove owner memberships (blocks admin -> owner self-escalation and
-- admin takeover by demoting/removing the owner)
-- ---------------------------------------------------------------------------

select pg_temp.impersonate('33333333-0000-4000-8000-000000000002');

select throws_ok(
  $$update public.organization_members set role = 'owner'
     where id = 'cccccccc-0000-4000-8000-000000000202'$$,
  '42501', null,
  'admin cannot promote themself to owner'
);

select throws_ok(
  $$insert into public.organization_members (organization_id, user_id, role)
    values ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', '33333333-0000-4000-8000-000000000006', 'owner')$$,
  '42501', null,
  'admin cannot insert a new owner-role membership'
);

update public.organization_members set role = 'viewer'
  where id = 'cccccccc-0000-4000-8000-000000000201';
delete from public.organization_members
  where id = 'cccccccc-0000-4000-8000-000000000201';

reset role;

select is(
  (select role::text from public.organization_members where id = 'cccccccc-0000-4000-8000-000000000201'),
  'owner',
  'admin cannot demote the owner'
);

select is(
  (select count(*)::int from public.organization_members where id = 'cccccccc-0000-4000-8000-000000000201'),
  1, 'admin cannot remove the owner''s membership row'
);

select pg_temp.impersonate('33333333-0000-4000-8000-000000000001');

select lives_ok(
  $$update public.organization_members set role = 'owner'
     where id = 'cccccccc-0000-4000-8000-000000000202'$$,
  'owner CAN promote a member to owner'
);

select lives_ok(
  $$update public.organization_members set role = 'admin'
     where id = 'cccccccc-0000-4000-8000-000000000202'$$,
  'owner can demote a co-owner while another owner remains'
);

-- ---------------------------------------------------------------------------
-- last-owner guard: the final owner can be neither demoted nor removed
-- ---------------------------------------------------------------------------

select throws_ok(
  $$update public.organization_members set role = 'admin'
     where id = 'cccccccc-0000-4000-8000-000000000201'$$,
  '23514', null,
  'the sole owner cannot be demoted (last-owner guard)'
);

select throws_ok(
  $$delete from public.organization_members
     where id = 'cccccccc-0000-4000-8000-000000000201'$$,
  '23514', null,
  'the sole owner''s membership cannot be deleted (last-owner guard)'
);

reset role;

-- ---------------------------------------------------------------------------
-- document_versions is append-only even for the owner (no client
-- UPDATE/DELETE grant exists, and no policy either)
-- ---------------------------------------------------------------------------

select pg_temp.impersonate('33333333-0000-4000-8000-000000000001');

select throws_ok(
  $$update public.document_versions set content_hash = 'forged'
     where id = 'cccccccc-0000-4000-8000-000000000303'$$,
  '42501', null,
  'owner cannot UPDATE document_versions (append-only)'
);

select throws_ok(
  $$delete from public.document_versions
     where id = 'cccccccc-0000-4000-8000-000000000303'$$,
  '42501', null,
  'owner cannot DELETE document_versions (append-only)'
);

reset role;

-- ---------------------------------------------------------------------------
-- soft delete IS deletion, so it is role-gated to owner/admin (data-model
-- §2: DELETE = owner/admin). Editors keep content updates but can neither
-- set nor clear deleted_at; admins can soft-delete and restore.
-- ---------------------------------------------------------------------------

select pg_temp.impersonate('33333333-0000-4000-8000-000000000003');

select throws_ok(
  $$update public.documents set deleted_at = now()
     where id = 'cccccccc-0000-4000-8000-000000000302'$$,
  '42501', null,
  'editor cannot soft-delete a document (deletion is owner/admin)'
);

select throws_ok(
  $$update public.projects set deleted_at = now()
     where id = 'cccccccc-0000-4000-8000-000000000301'$$,
  '42501', null,
  'editor cannot soft-delete a project (deletion is owner/admin)'
);

select throws_ok(
  $$update public.source_materials set deleted_at = now()
     where id = 'cccccccc-0000-4000-8000-000000000304'$$,
  '42501', null,
  'editor cannot soft-delete a source material (deletion is owner/admin)'
);

select pg_temp.impersonate('33333333-0000-4000-8000-000000000002');

select lives_ok(
  $$update public.documents set deleted_at = now()
     where id = 'cccccccc-0000-4000-8000-000000000302'$$,
  'admin CAN soft-delete a document'
);

select pg_temp.impersonate('33333333-0000-4000-8000-000000000003');

select is_empty(
  $$select id from public.documents where id = 'cccccccc-0000-4000-8000-000000000302'$$,
  'soft-deleted document is hidden from members'
);

update public.documents set title = 'Zombie Edit'
  where id = 'cccccccc-0000-4000-8000-000000000302';

reset role;

select is(
  (select title from public.documents where id = 'cccccccc-0000-4000-8000-000000000302'),
  'Edited by editor'::text,
  'editor cannot update a soft-deleted document'
);

select pg_temp.impersonate('33333333-0000-4000-8000-000000000002');

select lives_ok(
  $$update public.documents set deleted_at = null
     where id = 'cccccccc-0000-4000-8000-000000000302'$$,
  'admin CAN restore a soft-deleted document'
);

select pg_temp.impersonate('33333333-0000-4000-8000-000000000003');

select is(
  (select count(*)::int from public.documents where id = 'cccccccc-0000-4000-8000-000000000302'),
  1, 'restored document is visible to members again'
);

reset role;

-- ---------------------------------------------------------------------------
-- create_organization RPC: atomic org + owner membership; no hijacking
-- ---------------------------------------------------------------------------

select pg_temp.impersonate('33333333-0000-4000-8000-000000000009');

select lives_ok(
  $$create temporary table created_org as
      select * from public.create_organization('Outsider Org')$$,
  'RPC: a user with no memberships can create an organization'
);

select is(
  (select count(*)::int from public.organizations
    where id = (select id from created_org)),
  1, 'RPC: creator can immediately see the new org (membership was granted in the same call)'
);

reset role;

select is(
  (select role::text from public.organization_members
    where organization_id = (select id from created_org)
      and user_id = '33333333-0000-4000-8000-000000000009'),
  'owner',
  'RPC: creator received an owner membership atomically'
);

select is(
  (select count(*)::int from public.organization_members
    where organization_id = (select id from created_org)),
  1, 'RPC: exactly one membership exists on the new org'
);

select pg_temp.impersonate('33333333-0000-4000-8000-000000000009');

select throws_ok(
  $$select public.create_organization('   ')$$,
  '22023', null,
  'RPC: blank name is rejected'
);

-- Authenticated role but no sub claim: auth.uid() is null.

select set_config('request.jwt.claims', '{"role": "authenticated"}', true);
select set_config('role', 'authenticated', true);

select throws_ok(
  $$select public.create_organization('Ghost Org')$$,
  '42501', null,
  'RPC: rejected when there is no authenticated uid'
);

reset role;

select set_config('request.jwt.claims', '{"role": "anon"}', true);
select set_config('role', 'anon', true);

select throws_ok(
  $$select public.create_organization('Anon Org')$$,
  '42501', null,
  'RPC: anon has no EXECUTE grant'
);

reset role;

-- A second user cannot hijack the freshly created org.

select pg_temp.impersonate('33333333-0000-4000-8000-000000000005');

select is_empty(
  $$select id from public.organizations where id = (select id from created_org)$$,
  'hijack: a second user cannot see the new org'
);

select throws_ok(
  $$insert into public.organization_members (organization_id, user_id, role)
    select id, '33333333-0000-4000-8000-000000000005'::uuid, 'owner'::public.org_role
      from created_org$$,
  '42501', null,
  'hijack: a second user cannot grant themself membership in the new org'
);

update public.organizations set name = 'Hijacked'
  where id = (select id from created_org);

reset role;

select is(
  (select name from public.organizations where id = (select id from created_org)),
  'Outsider Org'::text,
  'hijack: a second user''s UPDATE on the new org had no effect'
);

select pg_temp.impersonate('33333333-0000-4000-8000-000000000005');

select lives_ok(
  $$create temporary table created_org2 as
      select * from public.create_organization('Second Org')$$,
  'RPC: a second user creates their own separate org'
);

reset role;

select is(
  (select user_id from public.organization_members
    where organization_id = (select id from created_org2)),
  '33333333-0000-4000-8000-000000000005'::uuid,
  'RPC: the second org belongs to the second user, not the first'
);

select is(
  (select count(*)::int from public.organization_members
    where organization_id = (select id from created_org)),
  1, 'hijack: the first org''s membership is untouched after the second RPC call'
);

-- ---------------------------------------------------------------------------
-- organization soft delete: RPC-only and owner-only (data-model §3 "soft
-- delete by owner"). A bare UPDATE cannot set organizations.deleted_at for
-- any role, and admins cannot delete the tenant.
-- ---------------------------------------------------------------------------

select pg_temp.impersonate('33333333-0000-4000-8000-000000000001');

select throws_ok(
  $$update public.organizations set deleted_at = now()
     where id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'$$,
  '42501', null,
  'even the owner cannot soft-delete an org via bare UPDATE (RPC is the only path)'
);

select pg_temp.impersonate('33333333-0000-4000-8000-000000000002');

select throws_ok(
  $$select public.soft_delete_organization('cccccccc-cccc-4ccc-8ccc-cccccccccccc')$$,
  '42501', null,
  'admin cannot soft-delete the organization (owner only)'
);

select pg_temp.impersonate('33333333-0000-4000-8000-000000000005');

select lives_ok(
  $$select public.soft_delete_organization((select id from created_org2))$$,
  'an owner can soft-delete their organization via the RPC'
);

select is_empty(
  $$select id from public.organizations where id = (select id from created_org2)$$,
  'a soft-deleted organization vanishes even for its owner'
);

reset role;

select * from finish();

rollback;
