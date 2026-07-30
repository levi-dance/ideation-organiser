import type { SupabaseClient } from "@supabase/supabase-js";
import { embedTexts, EMBEDDING_MODEL } from "@/lib/embeddings/voyage";
import { stripMarkdown } from "@/lib/notion/markdown";

export type EmbedItem = {
  entryId: string;
  entryDestinationId: string;
  title: string;
  body: string;
};

function embedContent(item: EmbedItem): string {
  return item.body ? `${item.title}\n${stripMarkdown(item.body)}` : item.title;
}

/**
 * Embed filed items and upsert into entry_embeddings. One batched Voyage call.
 * Idempotent (unique entry_destination_id + upsert) — safe for ingest, retry
 * cron, reassign, and backfill alike. Callers decide failure handling; this
 * must never block filing.
 */
export async function embedFiledItems(db: SupabaseClient, items: EmbedItem[]): Promise<void> {
  if (!items.length) return;
  const vectors = await embedTexts(items.map(embedContent), "document");
  const rows = items.map((item, i) => ({
    entry_id: item.entryId,
    entry_destination_id: item.entryDestinationId,
    content: embedContent(item),
    embedding: vectors[i],
    model: EMBEDDING_MODEL,
  }));
  const { error } = await db
    .from("entry_embeddings")
    .upsert(rows, { onConflict: "entry_destination_id" });
  if (error) throw new Error(`Failed to store embeddings: ${error.message}`);
}
