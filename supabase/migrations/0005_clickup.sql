-- ClickUp "Work" pathway: manual Work/Personal scope on entries, a log of
-- every ClickUp action taken, and a queue for Work ideas the classifier
-- wasn't confident enough to route (held for manual routing, never guessed).

alter table entries add column scope text not null default 'personal'
  check (scope in ('personal', 'work'));

-- Work entries where every idea was held for manual routing.
alter table entries drop constraint entries_status_check;
alter table entries add constraint entries_status_check
  check (status in ('pending','classifying','filed','partial_error','error','retracted','needs_routing'));

-- Every write the agent performs against ClickUp, for review in the entry log.
-- Mirrors entry_destinations for the Notion side. Append-only by design: the
-- agent may create tasks and append to descriptions, nothing else.
create table clickup_actions (
  id uuid primary key default gen_random_uuid(),
  entry_id uuid not null references entries(id) on delete cascade,
  list_id text not null,
  list_name text not null,
  action_type text not null check (action_type in ('create_task', 'append_description')),
  task_id text not null,
  task_name text not null,
  content_snippet text not null,
  warning text,
  created_at timestamptz not null default now()
);
create index clickup_actions_entry_idx on clickup_actions (entry_id);

-- Work ideas held back because list routing confidence was too low.
-- Manual routing from the entry log resolves them into clickup_actions.
create table work_routing_queue (
  id uuid primary key default gen_random_uuid(),
  entry_id uuid not null references entries(id) on delete cascade,
  title text not null,
  body text not null default '',
  candidate_list_id text,
  reason text,
  status text not null default 'queued' check (status in ('queued', 'routed', 'dismissed')),
  created_at timestamptz not null default now()
);
create index work_routing_queue_entry_idx on work_routing_queue (entry_id);
create index work_routing_queue_status_idx on work_routing_queue (status);
