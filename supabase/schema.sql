-- Second Brain - complete database schema.
-- New install: paste this whole file into the Supabase SQL Editor and run once.
-- (This is the consolidated form of what were migrations 0001–0007.)

create extension if not exists vector;

-- ── Taxonomy ────────────────────────────────────────────────────────────────

-- Self-referencing tree mirroring the Notion structure.
create table categories (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  name text not null,
  description text not null,
  parent_category_id uuid references categories(id),
  notion_page_id text, -- the Notion page this category mirrors (for sync)
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

-- ── Capture log ─────────────────────────────────────────────────────────────

-- Master entry log: source of truth for every raw capture.
create table entries (
  id uuid primary key default gen_random_uuid(),
  source text not null check (source in ('voice','text')),
  scope text not null default 'personal' check (scope in ('personal','work')),
  raw_transcript text not null,
  edited_transcript text,
  transcript_confidence numeric,
  status text not null default 'pending'
    check (status in ('pending','classifying','filed','partial_error','error','retracted','needs_routing')),
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
  development_prompts jsonb, -- 0-3 short "develop this idea" questions, when the idea earns them
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

-- Undo / reassign audit trail.
create table undo_log (
  id uuid primary key default gen_random_uuid(),
  entry_id uuid not null references entries(id),
  entry_destination_id uuid references entry_destinations(id),
  action text not null check (action in ('undo','reassign','undo_new_category')),
  before_state jsonb,
  after_state jsonb,
  created_at timestamptz not null default now()
);

-- Background retry queue (Notion/ClickUp write retries, embedding jobs).
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

-- ── Semantic search ("ask your brain") ──────────────────────────────────────

-- One embedding per filed item - the cleaned title+body is the semantic unit,
-- and each maps 1:1 to a citation (entry link + Notion link).
create table entry_embeddings (
  id uuid primary key default gen_random_uuid(),
  entry_id uuid not null references entries(id),
  entry_destination_id uuid not null references entry_destinations(id) unique,
  content text not null, -- the exact text embedded (title \n body, markdown stripped)
  embedding vector(1024) not null,
  model text not null,
  created_at timestamptz not null default now()
);

-- HNSW over IVFFlat: builds incrementally, no training data needed on an empty table.
create index entry_embeddings_hnsw_idx
  on entry_embeddings using hnsw (embedding vector_cosine_ops);

-- Cosine similarity search. Undone filings are excluded at query time via the
-- join, so undo/reassign needs no embedding cleanup.
create or replace function match_entries(
  query_embedding vector(1024),
  match_count int default 10
)
returns table (
  entry_id uuid,
  entry_destination_id uuid,
  content text,
  similarity float
)
language sql stable as $$
  select ee.entry_id, ee.entry_destination_id, ee.content,
         1 - (ee.embedding <=> query_embedding) as similarity
  from entry_embeddings ee
  join entry_destinations ed on ed.id = ee.entry_destination_id
  where ed.undone_at is null
  order by ee.embedding <=> query_embedding
  limit match_count;
$$;

-- ── ClickUp "Work" pathway (optional) ───────────────────────────────────────

-- The lists work captures may be filed into, managed on the Settings page.
-- description is routing guidance the classifier reads to pick a list, so it
-- is required. Unticking a list in Settings sets is_active false rather than
-- deleting the row, which is also what makes this table (once it has any row
-- at all) authoritative over the legacy CLICKUP_LISTS env var.
create table work_lists (
  id uuid primary key default gen_random_uuid(),
  list_id text unique not null, -- the real ClickUp List ID
  key text not null,            -- stable routing key the classifier returns
  name text not null,
  description text not null,
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Every write the agent performs against ClickUp, for review in the entry log.
-- Append-only by design: the agent may create tasks and append to descriptions.
create table clickup_actions (
  id uuid primary key default gen_random_uuid(),
  entry_id uuid not null references entries(id) on delete cascade,
  list_id text not null,
  list_name text not null,
  action_type text not null check (action_type in ('create_task','append_description')),
  task_id text not null,
  task_name text not null,
  content_snippet text not null,
  warning text,
  created_at timestamptz not null default now()
);

-- Work ideas held back because list routing confidence was too low.
-- Manual routing from the entry log resolves them into clickup_actions.
create table work_routing_queue (
  id uuid primary key default gen_random_uuid(),
  entry_id uuid not null references entries(id) on delete cascade,
  title text not null,
  body text not null default '',
  candidate_list_id text,
  reason text,
  status text not null default 'queued' check (status in ('queued','routed','dismissed')),
  created_at timestamptz not null default now()
);

-- ── AI instructions ─────────────────────────────────────────────────────────

-- User-authored instructions, compiled by Claude into rules the filing model
-- follows. One row per instruction (add/edit/delete independently); user_text
-- is the original words, compiled_text is what gets injected into prompts.
create table ai_instructions (
  id uuid primary key default gen_random_uuid(),
  scope text not null check (scope in ('personal','work','synthesis')),
  label text,
  user_text text not null,
  compiled_text text not null,
  is_active boolean not null default true,
  model text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ── Indexes ─────────────────────────────────────────────────────────────────

create index entries_created_at_idx on entries (created_at desc);
create index entry_destinations_entry_idx on entry_destinations (entry_id);
create index categories_parent_idx on categories (parent_category_id);
create index destinations_category_idx on destinations (category_id);
create index job_queue_pending_idx on job_queue (status, run_after);
create index entry_embeddings_entry_idx on entry_embeddings (entry_id);
create index work_lists_active_idx on work_lists (is_active, sort_order);
create index clickup_actions_entry_idx on clickup_actions (entry_id);
create index work_routing_queue_entry_idx on work_routing_queue (entry_id);
create index work_routing_queue_status_idx on work_routing_queue (status);
create index ai_instructions_scope_idx on ai_instructions (scope, created_at);

-- ── Row-level security ──────────────────────────────────────────────────────
-- Defense in depth. All app access goes through server-side routes using the
-- service-role key (which bypasses RLS); these policies only permit reads for
-- authenticated users if a client-side query ever happens.

alter table categories enable row level security;
alter table destinations enable row level security;
alter table entries enable row level security;
alter table entry_destinations enable row level security;
alter table classification_runs enable row level security;
alter table undo_log enable row level security;
alter table job_queue enable row level security;
alter table entry_embeddings enable row level security;
alter table ai_instructions enable row level security;
alter table work_lists enable row level security;

create policy "authenticated read" on categories for select to authenticated using (true);
create policy "authenticated read" on destinations for select to authenticated using (true);
create policy "authenticated read" on entries for select to authenticated using (true);
create policy "authenticated read" on entry_destinations for select to authenticated using (true);
create policy "authenticated read" on entry_embeddings for select to authenticated using (true);
create policy "authenticated read" on ai_instructions for select to authenticated using (true);
create policy "authenticated read" on work_lists for select to authenticated using (true);
