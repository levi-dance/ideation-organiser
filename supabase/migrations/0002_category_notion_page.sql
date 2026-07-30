-- Sync-from-Notion support: categories remember which Notion page they mirror,
-- so renames and moves in Notion update the right category instead of creating
-- duplicates.
alter table categories add column if not exists notion_page_id text;
