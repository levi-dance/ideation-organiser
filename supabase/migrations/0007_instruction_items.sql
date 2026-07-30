-- One row per individual instruction (was: one row per scope), so instructions
-- can be added, edited, and deleted independently. Existing rows carry over as
-- the scope's first item unchanged.
alter table ai_instructions drop constraint if exists ai_instructions_scope_key;
alter table ai_instructions add column if not exists label text;
create index if not exists ai_instructions_scope_idx on ai_instructions (scope, created_at);
