-- AI development prompts attached to a filed destination (0-3 short questions,
-- emitted by the classifier only for promising-but-thin ideas).
alter table entry_destinations add column if not exists development_prompts jsonb;
