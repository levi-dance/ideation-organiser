-- Second Brain ingestion tool — initial schema.
-- Full data model from ARCHITECTURE.md; later phases (dedup, undo, retries)
-- use tables created here so no further migrations are needed for them.

-- Taxonomy registry: self-referencing tree mirroring the Notion structure.
create table categories (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  name text not null,
  description text not null,
  parent_category_id uuid references categories(id),
  is_seed boolean not null default false,
  is_active boolean not null default true,
  created_by text not null default 'system' check (created_by in ('system','llm','user')),
  created_at timestamptz not null default now()
);

-- A concrete Notion filing target attached to any tree node.
create table destinations (
  id uuid primary key default gen_random_uuid(),
  category_id uuid not null references categories(id),
  kind text not null check (kind in ('bank_database','document_section')),
  notion_database_id text,
  notion_page_id text,
  notion_section_heading text,
  title text not null,
  dedup_enabled boolean not null default false,
  is_current_focus boolean not null default false,
  summary text,
  summary_updated_at timestamptz,
  is_active boolean not null default true,
  created_by text not null default 'system' check (created_by in ('system','llm','user')),
  created_at timestamptz not null default now()
);

-- Master entry log: source of truth for every raw capture.
create table entries (
  id uuid primary key default gen_random_uuid(),
  source text not null check (source in ('voice','text')),
  raw_transcript text not null,
  edited_transcript text,
  transcript_confidence numeric,
  status text not null default 'pending'
    check (status in ('pending','classifying','filed','partial_error','error','retracted')),
  followup_of_entry_id uuid references entries(id),
  created_at timestamptz not null default now()
);

-- Every Notion write an entry produced.
create table entry_destinations (
  id uuid primary key default gen_random_uuid(),
  entry_id uuid not null references entries(id),
  destination_id uuid not null references destinations(id),
  action_type text not null check (action_type in
    ('append_row','append_block','merge_update','create_destination')),
  notion_page_id text,
  notion_block_ids jsonb,
  content_snippet text not null,
  before_content text,
  created_new_category boolean not null default false,
  warning text,
  undone_at timestamptz,
  undone_reason text,
  created_at timestamptz not null default now()
);

-- Full audit of every LLM classification call.
create table classification_runs (
  id uuid primary key default gen_random_uuid(),
  entry_id uuid not null references entries(id),
  model text not null,
  prompt_version text not null,
  raw_response jsonb not null,
  latency_ms integer,
  input_tokens integer,
  output_tokens integer,
  cache_read_tokens integer,
  cost_estimate_usd numeric,
  created_at timestamptz not null default now()
);

-- Undo / reassign audit trail (used from Phase 2).
create table undo_log (
  id uuid primary key default gen_random_uuid(),
  entry_id uuid not null references entries(id),
  entry_destination_id uuid references entry_destinations(id),
  action text not null check (action in ('undo','reassign','undo_new_category')),
  before_state jsonb,
  after_state jsonb,
  created_at timestamptz not null default now()
);

-- Background retry queue (used from Phase 2).
create table job_queue (
  id uuid primary key default gen_random_uuid(),
  job_type text not null,
  payload jsonb not null,
  status text not null default 'queued' check (status in ('queued','processing','done','failed')),
  attempts integer not null default 0,
  last_error text,
  run_after timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index entries_created_at_idx on entries (created_at desc);
create index entry_destinations_entry_idx on entry_destinations (entry_id);
create index categories_parent_idx on categories (parent_category_id);
create index destinations_category_idx on destinations (category_id);
create index job_queue_pending_idx on job_queue (status, run_after);

-- RLS: defense in depth. All app access goes through server-side routes using
-- the service-role key (bypasses RLS); these policies only permit reads for
-- authenticated users if a client-side query ever happens.
alter table categories enable row level security;
alter table destinations enable row level security;
alter table entries enable row level security;
alter table entry_destinations enable row level security;
alter table classification_runs enable row level security;
alter table undo_log enable row level security;
alter table job_queue enable row level security;

create policy "authenticated read" on categories for select to authenticated using (true);
create policy "authenticated read" on destinations for select to authenticated using (true);
create policy "authenticated read" on entries for select to authenticated using (true);
create policy "authenticated read" on entry_destinations for select to authenticated using (true);
