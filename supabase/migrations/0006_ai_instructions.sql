-- User-authored AI instructions, compiled by Claude into rules the filing
-- model follows. One row per pipeline scope. The user's original words are
-- kept for re-editing; compiled_text is what gets injected into prompts.
create table ai_instructions (
  id uuid primary key default gen_random_uuid(),
  scope text not null unique check (scope in ('personal', 'work', 'synthesis')),
  user_text text not null,
  compiled_text text not null,
  is_active boolean not null default true,
  model text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table ai_instructions enable row level security;
create policy "authenticated read" on ai_instructions for select to authenticated using (true);
