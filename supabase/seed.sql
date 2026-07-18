-- ============================================================================
-- supabase/seed.sql — deterministic local development seed
--
-- Loaded by `supabase db reset` after migrations (config.toml [db.seed]).
-- Runs as the `postgres` role, which carries BYPASSRLS in Supabase local, so
-- forced RLS on the seeded tables (20260718000001_tenancy.sql) does not block
-- these inserts. All data is synthetic and non-sensitive (security.md T7:
-- seeds are synthetic fixtures, never production data).
--
-- Determinism: every id is a fixed UUID, every timestamp is a fixed literal,
-- and password hashes use a fixed bcrypt salt — two resets produce identical
-- rows. Idempotency: every insert is ON CONFLICT DO NOTHING, so re-running
-- the file against an already-seeded database is a no-op.
--
-- Fixture matrix (exercises security.md T1 negative RLS tests — two orgs,
-- cross-org member, and a member of nothing):
--
--   user                        | Org Alpha | Org Beta
--   ----------------------------+-----------+---------
--   alice.owner@example.com     | owner     | —
--   bob.editor@example.com      | editor    | viewer
--   carol.owner@example.com     | —         | owner
--   dave.solo@example.com       | —         | —        (member of NO org)
--
-- All four users sign in locally with password: password123
--
-- UUID scheme (fixed, grep-friendly):
--   0000…000N  auth.users            (1 alice, 2 bob, 3 carol, 4 dave)
--   1000…000N  organizations         (1 alpha, 2 beta)
--   2000…000N  organization_members  (1 alice@alpha, 2 bob@alpha,
--                                     3 carol@beta, 4 bob@beta)
--   3000…000N  projects              (1 alpha, 2 beta)
--   4000…000N  documents             (1 alpha, 2 beta)
--   5000…000N  document_versions     (1 alpha, 2 beta)
--   6000…000N  auth.identities       (1..4, matching users)
-- ============================================================================

begin;

-- ----------------------------------------------------------------------------
-- 1. Auth users
-- ----------------------------------------------------------------------------
-- Direct auth.users inserts (supported for local seeding). email_confirmed_at
-- is set so no confirmation flow is needed; confirmation/recovery/email-change
-- token columns are '' (not NULL) because GoTrue scans them as non-null
-- strings. The bcrypt salt is fixed for determinism — acceptable only because
-- this is a local seed with a public throwaway password.

insert into auth.users (
  instance_id,
  id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  raw_app_meta_data,
  raw_user_meta_data,
  created_at,
  updated_at,
  confirmation_token,
  recovery_token,
  email_change_token_new,
  email_change
)
values
  (
    '00000000-0000-0000-0000-000000000000',
    '00000000-0000-4000-8000-000000000001',
    'authenticated',
    'authenticated',
    'alice.owner@example.com',
    extensions.crypt('password123', '$2a$10$abcdefghijklmnopqrstuv'),
    '2026-07-18T00:00:00Z',
    '{"provider": "email", "providers": ["email"]}'::jsonb,
    '{"full_name": "Alice (alpha owner)"}'::jsonb,
    '2026-07-18T00:00:00Z',
    '2026-07-18T00:00:00Z',
    '', '', '', ''
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '00000000-0000-4000-8000-000000000002',
    'authenticated',
    'authenticated',
    'bob.editor@example.com',
    extensions.crypt('password123', '$2a$10$abcdefghijklmnopqrstuv'),
    '2026-07-18T00:00:00Z',
    '{"provider": "email", "providers": ["email"]}'::jsonb,
    '{"full_name": "Bob (alpha editor, beta viewer)"}'::jsonb,
    '2026-07-18T00:00:00Z',
    '2026-07-18T00:00:00Z',
    '', '', '', ''
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '00000000-0000-4000-8000-000000000003',
    'authenticated',
    'authenticated',
    'carol.owner@example.com',
    extensions.crypt('password123', '$2a$10$abcdefghijklmnopqrstuv'),
    '2026-07-18T00:00:00Z',
    '{"provider": "email", "providers": ["email"]}'::jsonb,
    '{"full_name": "Carol (beta owner)"}'::jsonb,
    '2026-07-18T00:00:00Z',
    '2026-07-18T00:00:00Z',
    '', '', '', ''
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '00000000-0000-4000-8000-000000000004',
    'authenticated',
    'authenticated',
    'dave.solo@example.com',
    extensions.crypt('password123', '$2a$10$abcdefghijklmnopqrstuv'),
    '2026-07-18T00:00:00Z',
    '{"provider": "email", "providers": ["email"]}'::jsonb,
    '{"full_name": "Dave (no org — negative-test user)"}'::jsonb,
    '2026-07-18T00:00:00Z',
    '2026-07-18T00:00:00Z',
    '', '', '', ''
  )
on conflict do nothing;

-- Email-provider identities so password sign-in works locally. For the email
-- provider, provider_id is the user id as text.

insert into auth.identities (
  id,
  user_id,
  identity_data,
  provider,
  provider_id,
  last_sign_in_at,
  created_at,
  updated_at
)
values
  (
    '60000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000000001',
    '{"sub": "00000000-0000-4000-8000-000000000001", "email": "alice.owner@example.com", "email_verified": true, "phone_verified": false}'::jsonb,
    'email',
    '00000000-0000-4000-8000-000000000001',
    '2026-07-18T00:00:00Z',
    '2026-07-18T00:00:00Z',
    '2026-07-18T00:00:00Z'
  ),
  (
    '60000000-0000-4000-8000-000000000002',
    '00000000-0000-4000-8000-000000000002',
    '{"sub": "00000000-0000-4000-8000-000000000002", "email": "bob.editor@example.com", "email_verified": true, "phone_verified": false}'::jsonb,
    'email',
    '00000000-0000-4000-8000-000000000002',
    '2026-07-18T00:00:00Z',
    '2026-07-18T00:00:00Z',
    '2026-07-18T00:00:00Z'
  ),
  (
    '60000000-0000-4000-8000-000000000003',
    '00000000-0000-4000-8000-000000000003',
    '{"sub": "00000000-0000-4000-8000-000000000003", "email": "carol.owner@example.com", "email_verified": true, "phone_verified": false}'::jsonb,
    'email',
    '00000000-0000-4000-8000-000000000003',
    '2026-07-18T00:00:00Z',
    '2026-07-18T00:00:00Z',
    '2026-07-18T00:00:00Z'
  ),
  (
    '60000000-0000-4000-8000-000000000004',
    '00000000-0000-4000-8000-000000000004',
    '{"sub": "00000000-0000-4000-8000-000000000004", "email": "dave.solo@example.com", "email_verified": true, "phone_verified": false}'::jsonb,
    'email',
    '00000000-0000-4000-8000-000000000004',
    '2026-07-18T00:00:00Z',
    '2026-07-18T00:00:00Z',
    '2026-07-18T00:00:00Z'
  )
on conflict do nothing;

-- ----------------------------------------------------------------------------
-- 2. Organizations
-- ----------------------------------------------------------------------------
-- Inserted directly (not via public.create_organization(): the RPC needs
-- auth.uid() and mints a random slug suffix — both wrong for a deterministic
-- seed). Memberships are inserted explicitly below.

insert into public.organizations (id, name, slug, settings, created_at, updated_at)
values
  (
    '10000000-0000-4000-8000-000000000001',
    'Org Alpha',
    'org-alpha',
    '{"schema_version": 1}'::jsonb,
    '2026-07-18T00:00:00Z',
    '2026-07-18T00:00:00Z'
  ),
  (
    '10000000-0000-4000-8000-000000000002',
    'Org Beta',
    'org-beta',
    '{"schema_version": 1}'::jsonb,
    '2026-07-18T00:00:00Z',
    '2026-07-18T00:00:00Z'
  )
on conflict do nothing;

-- ----------------------------------------------------------------------------
-- 3. Memberships (matrix in the header)
-- ----------------------------------------------------------------------------
-- Dave (…0004) intentionally gets NO row: he is the "authenticated but member
-- of nothing" fixture for negative RLS tests. Bob spans both orgs with
-- different roles, exercising per-org role gating.

insert into public.organization_members (id, organization_id, user_id, role, invited_by, created_at, updated_at)
values
  ( -- alice: owner of Org Alpha
    '20000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000000001',
    'owner',
    null,
    '2026-07-18T00:00:00Z',
    '2026-07-18T00:00:00Z'
  ),
  ( -- bob: editor in Org Alpha (invited by alice)
    '20000000-0000-4000-8000-000000000002',
    '10000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000000002',
    'editor',
    '00000000-0000-4000-8000-000000000001',
    '2026-07-18T00:00:00Z',
    '2026-07-18T00:00:00Z'
  ),
  ( -- carol: owner of Org Beta
    '20000000-0000-4000-8000-000000000003',
    '10000000-0000-4000-8000-000000000002',
    '00000000-0000-4000-8000-000000000003',
    'owner',
    null,
    '2026-07-18T00:00:00Z',
    '2026-07-18T00:00:00Z'
  ),
  ( -- bob: viewer in Org Beta (invited by carol)
    '20000000-0000-4000-8000-000000000004',
    '10000000-0000-4000-8000-000000000002',
    '00000000-0000-4000-8000-000000000002',
    'viewer',
    '00000000-0000-4000-8000-000000000003',
    '2026-07-18T00:00:00Z',
    '2026-07-18T00:00:00Z'
  )
on conflict do nothing;

-- ----------------------------------------------------------------------------
-- 4. Projects (one per org)
-- ----------------------------------------------------------------------------
-- llm_provider / llm_model left to their column defaults
-- ('anthropic' / 'claude-sonnet-5' — the frozen pinned model).

insert into public.projects (id, organization_id, name, description, settings, created_at, updated_at)
values
  (
    '30000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000001',
    'Alpha Launch Notes',
    'Seed project for Org Alpha (local development fixture).',
    '{"schema_version": 1}'::jsonb,
    '2026-07-18T00:00:00Z',
    '2026-07-18T00:00:00Z'
  ),
  (
    '30000000-0000-4000-8000-000000000002',
    '10000000-0000-4000-8000-000000000002',
    'Beta Field Guide',
    'Seed project for Org Beta (local development fixture).',
    '{"schema_version": 1}'::jsonb,
    '2026-07-18T00:00:00Z',
    '2026-07-18T00:00:00Z'
  )
on conflict do nothing;

-- ----------------------------------------------------------------------------
-- 5. Documents (one per project; organization_id denormalized, enforced by
--    the composite FK (project_id, organization_id))
-- ----------------------------------------------------------------------------

insert into public.documents (id, project_id, organization_id, title, kind, created_at, updated_at)
values
  (
    '40000000-0000-4000-8000-000000000001',
    '30000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000001',
    'Alpha Welcome Document',
    'document',
    '2026-07-18T00:00:00Z',
    '2026-07-18T00:00:00Z'
  ),
  (
    '40000000-0000-4000-8000-000000000002',
    '30000000-0000-4000-8000-000000000002',
    '10000000-0000-4000-8000-000000000002',
    'Beta Welcome Document',
    'document',
    '2026-07-18T00:00:00Z',
    '2026-07-18T00:00:00Z'
  )
on conflict do nothing;

-- ----------------------------------------------------------------------------
-- 6. Document versions (one per document; append-only table — created_at only)
-- ----------------------------------------------------------------------------
-- content follows the data-model §1 JSONB convention (schema_version field).
-- content_hash values are fixed placeholder sha-256 hex literals: the column
-- only requires a non-blank hash, and the hashing convention is defined by the
-- application layer in a later milestone. created_by is each org's owner.

insert into public.document_versions (id, document_id, organization_id, content, content_hash, created_by, created_at)
values
  (
    '50000000-0000-4000-8000-000000000001',
    '40000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000001',
    '{"schema_version": 1, "type": "doc", "content": [{"type": "paragraph", "content": [{"type": "text", "text": "Seed snapshot for Org Alpha welcome document."}]}]}'::jsonb,
    'seedseedseedseedseedseedseedseedseedseedseedseedseedseedseed0001',
    '00000000-0000-4000-8000-000000000001',
    '2026-07-18T00:00:00Z'
  ),
  (
    '50000000-0000-4000-8000-000000000002',
    '40000000-0000-4000-8000-000000000002',
    '10000000-0000-4000-8000-000000000002',
    '{"schema_version": 1, "type": "doc", "content": [{"type": "paragraph", "content": [{"type": "text", "text": "Seed snapshot for Org Beta welcome document."}]}]}'::jsonb,
    'seedseedseedseedseedseedseedseedseedseedseedseedseedseedseed0002',
    '00000000-0000-4000-8000-000000000003',
    '2026-07-18T00:00:00Z'
  )
on conflict do nothing;

commit;
