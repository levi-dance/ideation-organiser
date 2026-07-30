import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { notion, notionUrl } from "@/lib/notion/client";
import { writeToDestination } from "@/lib/notion/write";
import { stripMarkdown } from "@/lib/notion/markdown";
import { embedFiledItems } from "@/lib/pipeline/embed";
import type { Classification } from "@/lib/claude/classify";
import type { DestinationWithCategory, EntryDestination } from "@/lib/types";

function adminDb(): SupabaseClient {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );
}

/** Revert one filed destination in Notion and mark it undone in the log. */
export async function undoDestination(
  entryDestinationId: string,
  reason: string
): Promise<void> {
  const db = adminDb();
  const { data: fd } = await db
    .from("entry_destinations")
    .select("*")
    .eq("id", entryDestinationId)
    .single<EntryDestination>();
  if (!fd) throw new Error("Filed destination not found");
  if (fd.undone_at) throw new Error("Already undone");

  if (fd.action_type === "append_row") {
    if (!fd.notion_page_id) throw new Error("No Notion page recorded for this row");
    // Trash, never hard-delete — recoverable from Notion's own trash.
    await notion().pages.update({ page_id: fd.notion_page_id, in_trash: true });
  } else if (fd.action_type === "append_block") {
    for (const blockId of fd.notion_block_ids ?? []) {
      await notion().blocks.delete({ block_id: blockId });
    }
  } else {
    throw new Error(`Undo not supported for action type ${fd.action_type}`);
  }

  await db
    .from("entry_destinations")
    .update({ undone_at: new Date().toISOString(), undone_reason: reason })
    .eq("id", fd.id);
  await db.from("undo_log").insert({
    entry_id: fd.entry_id,
    entry_destination_id: fd.id,
    action: "undo",
    before_state: { notion_page_id: fd.notion_page_id, notion_block_ids: fd.notion_block_ids },
    after_state: { reason },
  });

  // If nothing remains filed, the entry as a whole is retracted.
  const { count } = await db
    .from("entry_destinations")
    .select("*", { count: "exact", head: true })
    .eq("entry_id", fd.entry_id)
    .is("undone_at", null);
  if (!count) {
    await db.from("entries").update({ status: "retracted" }).eq("id", fd.entry_id);
  }
}

/**
 * Move a filed item to a different destination: undo the original Notion write,
 * re-file the same formatted content into the target.
 */
export async function reassignDestination(
  entryDestinationId: string,
  toDestinationId: string
): Promise<{ destinationTitle: string; notionUrl: string | null }> {
  const db = adminDb();
  const { data: fd } = await db
    .from("entry_destinations")
    .select("*")
    .eq("id", entryDestinationId)
    .single<EntryDestination>();
  if (!fd) throw new Error("Filed destination not found");
  if (fd.undone_at) throw new Error("Already undone — file it again from a new capture");

  const { data: target } = await db
    .from("destinations")
    .select("*, category:categories(*)")
    .eq("id", toDestinationId)
    .single();
  if (!target) throw new Error("Target destination not found");
  const dest = target as unknown as DestinationWithCategory;

  // Recover the formatted title/body from the classification run if we can;
  // fall back to splitting the stored snippet.
  let title = fd.content_snippet;
  let body = "";
  const sep = fd.content_snippet.indexOf(" — ");
  if (sep !== -1) {
    title = fd.content_snippet.slice(0, sep);
    body = fd.content_snippet.slice(sep + 3);
  }
  const { data: run } = await db
    .from("classification_runs")
    .select("raw_response")
    .eq("entry_id", fd.entry_id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const classified = (run?.raw_response as Classification | null)?.destinations?.find(
    (d) => d.destination_id === fd.destination_id && d.formatted_title === title
  );
  if (classified) {
    title = classified.formatted_title;
    body = classified.formatted_body;
  }
  const prompts = classified?.development_prompts?.slice(0, 3) ?? fd.development_prompts ?? [];

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  const write = await writeToDestination(
    dest,
    title,
    body,
    `${appUrl}/entries/${fd.entry_id}`,
    prompts
  );

  // Only after the new write succeeds, undo the original.
  await undoDestination(fd.id, `reassigned to ${dest.title}`);

  const { data: created, error: createError } = await db
    .from("entry_destinations")
    .insert({
      entry_id: fd.entry_id,
      destination_id: dest.id,
      action_type: dest.kind === "bank_database" ? "append_row" : "append_block",
      notion_page_id: write.notionPageId,
      notion_block_ids: write.notionBlockIds,
      content_snippet: `${title}${body ? ` — ${stripMarkdown(body)}` : ""}`,
      development_prompts: prompts.length ? prompts : null,
      warning: write.warning,
    })
    .select()
    .single();
  if (createError || !created) {
    throw new Error(
      `Re-filed to ${dest.title} in Notion, but the entry-log insert failed: ${
        createError?.message ?? "no row returned"
      }`
    );
  }

  // Keep semantic search consistent after the move; the old row's embedding is
  // excluded at query time (its filing is now undone), so a failure here is
  // cosmetic — swallow it.
  if (created) {
    try {
      await embedFiledItems(db, [
        { entryId: fd.entry_id, entryDestinationId: created.id, title, body },
      ]);
    } catch {
      // non-fatal
    }
  }

  await db.from("undo_log").insert({
    entry_id: fd.entry_id,
    entry_destination_id: fd.id,
    action: "reassign",
    before_state: { destination_id: fd.destination_id },
    after_state: { destination_id: dest.id, new_entry_destination_id: created?.id },
  });
  // Reassign leaves the entry filed.
  await db.from("entries").update({ status: "filed" }).eq("id", fd.entry_id);

  return {
    destinationTitle: dest.title,
    notionUrl: write.notionPageId ? notionUrl(write.notionPageId) : null,
  };
}
