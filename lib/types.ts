export type Category = {
  id: string;
  slug: string;
  name: string;
  description: string;
  parent_category_id: string | null;
  is_seed: boolean;
  is_active: boolean;
  created_by: "system" | "llm" | "user";
  created_at: string;
};

export type Destination = {
  id: string;
  category_id: string;
  kind: "bank_database" | "document_section";
  notion_database_id: string | null;
  notion_page_id: string | null;
  notion_section_heading: string | null;
  title: string;
  dedup_enabled: boolean;
  is_current_focus: boolean;
  summary: string | null;
  is_active: boolean;
  created_at: string;
};

export type Entry = {
  id: string;
  source: "voice" | "text";
  scope: "personal" | "work";
  raw_transcript: string;
  edited_transcript: string | null;
  transcript_confidence: number | null;
  status:
    | "pending"
    | "classifying"
    | "filed"
    | "partial_error"
    | "error"
    | "retracted"
    | "needs_routing";
  followup_of_entry_id: string | null;
  created_at: string;
};

export type EntryDestination = {
  id: string;
  entry_id: string;
  destination_id: string;
  action_type: "append_row" | "append_block" | "merge_update" | "create_destination";
  notion_page_id: string | null;
  notion_block_ids: string[] | null;
  content_snippet: string;
  development_prompts: string[] | null;
  created_new_category: boolean;
  warning: string | null;
  undone_at: string | null;
  created_at: string;
};

/** Destination joined with its category, as the pipeline and UI consume it. */
export type DestinationWithCategory = Destination & { category: Category };

/** A write the agent performed against ClickUp (Work pathway). Append-only. */
export type ClickUpAction = {
  id: string;
  entry_id: string;
  list_id: string;
  list_name: string;
  action_type: "create_task" | "append_description";
  task_id: string;
  task_name: string;
  content_snippet: string;
  warning: string | null;
  created_at: string;
};

/** A Work idea held back for manual routing (list confidence too low). */
export type WorkRoutingQueueItem = {
  id: string;
  entry_id: string;
  title: string;
  body: string;
  candidate_list_id: string | null;
  reason: string | null;
  status: "queued" | "routed" | "dismissed";
  created_at: string;
};
