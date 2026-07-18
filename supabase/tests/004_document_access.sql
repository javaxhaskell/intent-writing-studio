-- ============================================================================
-- 004_document_access.sql — public.get_document_access(uuid)
--
-- Verifies supabase/migrations/20260718000003_document_access.sql against
-- docs/data-model.md §3 (reviewer = commenter/reviewer role):
--   * structural posture: SECURITY DEFINER, STABLE, EXECUTE granted to
--     authenticated and denied to anon;
--   * every member role maps to the intended capabilities —
--     owner/admin/editor edit+comment, reviewer comment-only, viewer neither;
--   * a member of a DIFFERENT organization gets zero rows on a foreign
--     document (and vice versa) — membership never transfers across tenants;
--   * a nonexistent document id yields zero rows too, so "no access" and
--     "does not exist" are indistinguishable (no existence oracle);
--   * a soft-deleted document yields zero rows even for owner/admin — even
--     though documents_select deliberately keeps the trashed row VISIBLE to
--     them (trash/restore view), it must not be editor-openable;
--   * a soft-deleted organization yields zero rows even for its owner
--     (live-org semantics mirror app_private.is_org_member);
--   * an authenticated session without a uid resolves to zero rows, and anon
--     lacks EXECUTE outright.
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

select plan(19);

-- ---------------------------------------------------------------------------
-- Fixtures: Org Delta with every role represented + a live and a trashed
-- document; Org Epsilon as the foreign tenant (its owner is Delta's outsider)
-- ---------------------------------------------------------------------------

insert into auth.users (id, email) values
  ('44444444-0000-4000-8000-000000000001', 'delta-owner@rls.test'),
  ('44444444-0000-4000-8000-000000000002', 'delta-admin@rls.test'),
  ('44444444-0000-4000-8000-000000000003', 'delta-editor@rls.test'),
  ('44444444-0000-4000-8000-000000000004', 'delta-reviewer@rls.test'),
  ('44444444-0000-4000-8000-000000000005', 'delta-viewer@rls.test'),
  ('44444444-0000-4000-8000-000000000006', 'epsilon-owner@rls.test');

-- Slugs are pgtap-004-* so the suite also runs against a seeded database
-- (supabase/seed.sql occupies org-alpha / org-beta; slugs are UNIQUE).
insert into public.organizations (id, name, slug) values
  ('dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'Org Delta',   'pgtap-004-delta'),
  ('eeeeeeee-0000-4000-8000-000000000001', 'Org Epsilon', 'pgtap-004-epsilon');

insert into public.organization_members (organization_id, user_id, role) values
  ('dddddddd-dddd-4ddd-8ddd-dddddddddddd', '44444444-0000-4000-8000-000000000001', 'owner'),
  ('dddddddd-dddd-4ddd-8ddd-dddddddddddd', '44444444-0000-4000-8000-000000000002', 'admin'),
  ('dddddddd-dddd-4ddd-8ddd-dddddddddddd', '44444444-0000-4000-8000-000000000003', 'editor'),
  ('dddddddd-dddd-4ddd-8ddd-dddddddddddd', '44444444-0000-4000-8000-000000000004', 'reviewer'),
  ('dddddddd-dddd-4ddd-8ddd-dddddddddddd', '44444444-0000-4000-8000-000000000005', 'viewer'),
  ('eeeeeeee-0000-4000-8000-000000000001', '44444444-0000-4000-8000-000000000006', 'owner');

insert into public.projects (id, organization_id, name) values
  ('dddddddd-0000-4000-8000-000000000301', 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'Delta Project'),
  ('eeeeeeee-0000-4000-8000-000000000301', 'eeeeeeee-0000-4000-8000-000000000001', 'Epsilon Project');

insert into public.documents (id, project_id, organization_id, title, deleted_at) values
  ('dddddddd-0000-4000-8000-000000000302', 'dddddddd-0000-4000-8000-000000000301',
   'dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'Delta Doc', null),
  ('dddddddd-0000-4000-8000-000000000303', 'dddddddd-0000-4000-8000-000000000301',
   'dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'Delta Trashed Doc', now()),
  ('eeeeeeee-0000-4000-8000-000000000302', 'eeeeeeee-0000-4000-8000-000000000301',
   'eeeeeeee-0000-4000-8000-000000000001', 'Epsilon Doc', null);

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
-- Structural posture: definer, stable, EXECUTE locked to authenticated
-- ---------------------------------------------------------------------------

select has_function('public', 'get_document_access', array['uuid'],
  'public.get_document_access(uuid) exists');

select is_definer('public', 'get_document_access', array['uuid'],
  'get_document_access is SECURITY DEFINER (pins its own liveness predicate)');

select volatility_is('public', 'get_document_access', array['uuid'], 'stable',
  'get_document_access is STABLE');

select ok(has_function_privilege('authenticated', 'public.get_document_access(uuid)', 'execute'),
  'authenticated can execute get_document_access');

select ok(not has_function_privilege('anon', 'public.get_document_access(uuid)', 'execute'),
  'anon cannot execute get_document_access');

-- ---------------------------------------------------------------------------
-- Role -> capability matrix on a live document (exactly one row per member)
-- ---------------------------------------------------------------------------

select pg_temp.impersonate('44444444-0000-4000-8000-000000000001');

select results_eq(
  $$select * from public.get_document_access('dddddddd-0000-4000-8000-000000000302'::uuid)$$,
  $$values ('owner'::text, true, true)$$,
  'owner: can_edit + can_comment'
);

select pg_temp.impersonate('44444444-0000-4000-8000-000000000002');

select results_eq(
  $$select * from public.get_document_access('dddddddd-0000-4000-8000-000000000302'::uuid)$$,
  $$values ('admin'::text, true, true)$$,
  'admin: can_edit + can_comment'
);

select pg_temp.impersonate('44444444-0000-4000-8000-000000000003');

select results_eq(
  $$select * from public.get_document_access('dddddddd-0000-4000-8000-000000000302'::uuid)$$,
  $$values ('editor'::text, true, true)$$,
  'editor: can_edit + can_comment'
);

select pg_temp.impersonate('44444444-0000-4000-8000-000000000004');

select results_eq(
  $$select * from public.get_document_access('dddddddd-0000-4000-8000-000000000302'::uuid)$$,
  $$values ('reviewer'::text, false, true)$$,
  'reviewer: comment-only (can_edit = false, can_comment = true)'
);

select pg_temp.impersonate('44444444-0000-4000-8000-000000000005');

select results_eq(
  $$select * from public.get_document_access('dddddddd-0000-4000-8000-000000000302'::uuid)$$,
  $$values ('viewer'::text, false, false)$$,
  'viewer: neither edit nor comment'
);

-- ---------------------------------------------------------------------------
-- Cross-tenant + nonexistent ids: zero rows, no existence oracle
-- ---------------------------------------------------------------------------

select pg_temp.impersonate('44444444-0000-4000-8000-000000000006');

select is_empty(
  $$select * from public.get_document_access('dddddddd-0000-4000-8000-000000000302'::uuid)$$,
  'a member of another organization gets zero rows on a foreign document'
);

select pg_temp.impersonate('44444444-0000-4000-8000-000000000001');

select is_empty(
  $$select * from public.get_document_access('eeeeeeee-0000-4000-8000-000000000302'::uuid)$$,
  'Delta''s owner gets zero rows on Epsilon''s document (membership never transfers)'
);

select is_empty(
  $$select * from public.get_document_access('ffffffff-ffff-4fff-8fff-ffffffffffff'::uuid)$$,
  'a nonexistent document id yields zero rows — indistinguishable from no access'
);

-- ---------------------------------------------------------------------------
-- Soft-deleted document: zero rows even for owner/admin, although
-- documents_select still shows them the trashed row (trash view != openable)
-- ---------------------------------------------------------------------------

select is_empty(
  $$select * from public.get_document_access('dddddddd-0000-4000-8000-000000000303'::uuid)$$,
  'soft-deleted document yields zero rows for the owner'
);

select pg_temp.impersonate('44444444-0000-4000-8000-000000000002');

select is_empty(
  $$select * from public.get_document_access('dddddddd-0000-4000-8000-000000000303'::uuid)$$,
  'soft-deleted document yields zero rows for an admin too'
);

select is(
  (select count(*)::int from public.documents
    where id = 'dddddddd-0000-4000-8000-000000000303'),
  1,
  'contrast: the same admin still SEES the trashed row via documents_select (row visible != may open editor)'
);

reset role;

-- ---------------------------------------------------------------------------
-- No uid / anon
-- ---------------------------------------------------------------------------

-- Authenticated role but no sub claim: auth.uid() is null.

select set_config('request.jwt.claims', '{"role": "authenticated"}', true);
select set_config('role', 'authenticated', true);

select is_empty(
  $$select * from public.get_document_access('dddddddd-0000-4000-8000-000000000302'::uuid)$$,
  'authenticated session without a uid resolves to zero rows'
);

reset role;

select set_config('request.jwt.claims', '{"role": "anon"}', true);
select set_config('role', 'anon', true);

select throws_ok(
  $$select * from public.get_document_access('dddddddd-0000-4000-8000-000000000302'::uuid)$$,
  '42501', null,
  'anon is denied EXECUTE outright'
);

reset role;

-- ---------------------------------------------------------------------------
-- Soft-deleted organization: the whole subtree stops being openable at once,
-- even for the org''s own owner (live-org semantics)
-- ---------------------------------------------------------------------------

update public.organizations set deleted_at = now()
  where id = 'eeeeeeee-0000-4000-8000-000000000001';

select pg_temp.impersonate('44444444-0000-4000-8000-000000000006');

select is_empty(
  $$select * from public.get_document_access('eeeeeeee-0000-4000-8000-000000000302'::uuid)$$,
  'a document in a soft-deleted organization yields zero rows even for the org owner'
);

reset role;

select * from finish();

rollback;
