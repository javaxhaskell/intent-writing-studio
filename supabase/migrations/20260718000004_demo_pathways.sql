-- Demo slice: pathway exploration, intent graph, provenance-linked draft blocks,
-- targeted regeneration proposals. Simplified from docs/data-model.md for the
-- deadline demo: dependency edges are a parent tree on intent_nodes; block
-- provenance is a single intent link; proposals live on the block row.
-- All tables org-scoped one-hop (denormalized organization_id + composite FKs),
-- RLS enabled AND forced, following 20260718000001_tenancy.sql patterns.

-- ---------------------------------------------------------------------------
-- pathway_sets: one brief -> one generation event
-- ---------------------------------------------------------------------------
create table public.pathway_sets (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  document_id uuid not null,
  brief jsonb not null,
  status text not null default 'ready'
    check (status in ('generating', 'ready', 'failed')),
  model_id text not null default 'claude-sonnet-5',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (document_id, organization_id)
    references public.documents (id, organization_id) on delete cascade,
  unique (id, organization_id)
);

alter table public.pathway_sets enable row level security;
alter table public.pathway_sets force row level security;

create trigger pathway_sets_set_updated_at
  before update on public.pathway_sets
  for each row execute function app_private.set_updated_at();

create policy pathway_sets_select on public.pathway_sets
  for select to authenticated
  using (app_private.is_org_member(organization_id));

create policy pathway_sets_insert on public.pathway_sets
  for insert to authenticated
  with check (app_private.has_org_role(organization_id, array['owner', 'admin', 'editor']));

create policy pathway_sets_update on public.pathway_sets
  for update to authenticated
  using (app_private.has_org_role(organization_id, array['owner', 'admin', 'editor']))
  with check (app_private.has_org_role(organization_id, array['owner', 'admin', 'editor']));

create policy pathway_sets_delete on public.pathway_sets
  for delete to authenticated
  using (app_private.has_org_role(organization_id, array['owner', 'admin']));

-- ---------------------------------------------------------------------------
-- pathways: one distinct strategy inside a set (full card payload as jsonb,
-- zod-validated at the application boundary before insert)
-- ---------------------------------------------------------------------------
create table public.pathways (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  pathway_set_id uuid not null,
  payload jsonb not null,
  rank integer not null default 0,
  selected boolean not null default false,
  created_at timestamptz not null default now(),
  foreign key (pathway_set_id, organization_id)
    references public.pathway_sets (id, organization_id) on delete cascade,
  unique (id, organization_id)
);

alter table public.pathways enable row level security;
alter table public.pathways force row level security;

create policy pathways_select on public.pathways
  for select to authenticated
  using (app_private.is_org_member(organization_id));

create policy pathways_insert on public.pathways
  for insert to authenticated
  with check (app_private.has_org_role(organization_id, array['owner', 'admin', 'editor']));

create policy pathways_update on public.pathways
  for update to authenticated
  using (app_private.has_org_role(organization_id, array['owner', 'admin', 'editor']))
  with check (app_private.has_org_role(organization_id, array['owner', 'admin', 'editor']));

create policy pathways_delete on public.pathways
  for delete to authenticated
  using (app_private.has_org_role(organization_id, array['owner', 'admin']));

-- ---------------------------------------------------------------------------
-- intent_nodes: the intent graph. Dependency edges are the parent tree
-- (parent stale-ness propagates to descendants). pathway provenance kept.
-- ---------------------------------------------------------------------------
create table public.intent_nodes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  document_id uuid not null,
  pathway_id uuid,
  parent_id uuid references public.intent_nodes (id) on delete cascade,
  kind text not null
    check (kind in ('thesis', 'audience', 'tone', 'section_goal', 'paragraph_goal', 'ending')),
  title text not null,
  purpose text not null default '',
  position integer not null default 0,
  status text not null default 'current'
    check (status in ('current', 'stale')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (document_id, organization_id)
    references public.documents (id, organization_id) on delete cascade,
  unique (id, organization_id)
);

alter table public.intent_nodes enable row level security;
alter table public.intent_nodes force row level security;

create trigger intent_nodes_set_updated_at
  before update on public.intent_nodes
  for each row execute function app_private.set_updated_at();

create policy intent_nodes_select on public.intent_nodes
  for select to authenticated
  using (app_private.is_org_member(organization_id));

create policy intent_nodes_insert on public.intent_nodes
  for insert to authenticated
  with check (app_private.has_org_role(organization_id, array['owner', 'admin', 'editor']));

create policy intent_nodes_update on public.intent_nodes
  for update to authenticated
  using (app_private.has_org_role(organization_id, array['owner', 'admin', 'editor']))
  with check (app_private.has_org_role(organization_id, array['owner', 'admin', 'editor']));

create policy intent_nodes_delete on public.intent_nodes
  for delete to authenticated
  using (app_private.has_org_role(organization_id, array['owner', 'admin', 'editor']));

-- ---------------------------------------------------------------------------
-- doc_blocks: draft blocks causally linked to intent nodes. Regeneration
-- writes proposed_md; accept copies it into content_md, reject clears it.
-- ---------------------------------------------------------------------------
create table public.doc_blocks (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  document_id uuid not null,
  intent_node_id uuid not null,
  position integer not null default 0,
  content_md text not null default '',
  proposed_md text,
  content_hash text not null default '',
  freshness text not null default 'current'
    check (freshness in ('current', 'stale', 'regenerating', 'proposed')),
  locked boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (document_id, organization_id)
    references public.documents (id, organization_id) on delete cascade,
  foreign key (intent_node_id, organization_id)
    references public.intent_nodes (id, organization_id) on delete cascade,
  unique (id, organization_id)
);

alter table public.doc_blocks enable row level security;
alter table public.doc_blocks force row level security;

create trigger doc_blocks_set_updated_at
  before update on public.doc_blocks
  for each row execute function app_private.set_updated_at();

create policy doc_blocks_select on public.doc_blocks
  for select to authenticated
  using (app_private.is_org_member(organization_id));

create policy doc_blocks_insert on public.doc_blocks
  for insert to authenticated
  with check (app_private.has_org_role(organization_id, array['owner', 'admin', 'editor']));

create policy doc_blocks_update on public.doc_blocks
  for update to authenticated
  using (app_private.has_org_role(organization_id, array['owner', 'admin', 'editor']))
  with check (app_private.has_org_role(organization_id, array['owner', 'admin', 'editor']));

create policy doc_blocks_delete on public.doc_blocks
  for delete to authenticated
  using (app_private.has_org_role(organization_id, array['owner', 'admin', 'editor']));

create index intent_nodes_document_idx on public.intent_nodes (document_id, position);
create index intent_nodes_parent_idx on public.intent_nodes (parent_id);
create index doc_blocks_document_idx on public.doc_blocks (document_id, position);
create index doc_blocks_intent_idx on public.doc_blocks (intent_node_id);
create index pathways_set_idx on public.pathways (pathway_set_id, rank);
