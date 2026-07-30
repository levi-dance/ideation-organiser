-- Semantic search: pgvector embeddings for filed items ("ask your brain").
-- One embedding per filed destination item — the cleaned title+body is the
-- semantic unit (a capture can hold several unrelated ideas), and each maps
-- 1:1 to a citation (entry link + Notion link).

create extension if not exists vector;

create table entry_embeddings (
  id uuid primary key default gen_random_uuid(),
  entry_id uuid not null references entries(id),
  entry_destination_id uuid not null references entry_destinations(id) unique,
  content text not null, -- the exact text that was embedded (title \n body, markdown stripped)
  embedding vector(1024) not null,
  model text not null,
  created_at timestamptz not null default now()
);

create index entry_embeddings_entry_idx on entry_embeddings (entry_id);

-- HNSW over IVFFlat: builds incrementally, no training data needed on an empty table.
create index entry_embeddings_hnsw_idx
  on entry_embeddings using hnsw (embedding vector_cosine_ops);

alter table entry_embeddings enable row level security;
create policy "authenticated read" on entry_embeddings for select to authenticated using (true);

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
