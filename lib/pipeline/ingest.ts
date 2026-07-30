import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { classifyEntry, PROMPT_VERSION } from "@/lib/claude/classify";
import { writeToDestination } from "@/lib/notion/write";
import { stripMarkdown } from "@/lib/notion/markdown";
import { notionUrl } from "@/lib/notion/client";
import { embedFiledItems, type EmbedItem } from "@/lib/pipeline/embed";
import type { DestinationWithCategory } from "@/lib/types";

export type IngestResult = {
  entryId: string;
  status: "filed" | "partial_error" | "error";
  filed: {
    destinationTitle: string;
    categoryName: string;
    title: string;
    notionUrl: string | null;
    warning: string | null;
  }[];
  errors: string[];
  lowConfidence: boolean;
};

const CATCH_ALL_SLUG = "general-notes";

function isTransient(e: unknown): boolean {
  const status = (e as { status?: number })?.status;
  return status === 429 || (typeof status === "number" && status >= 500);
}

/** Retry transient Notion failures a couple of times before giving up. */
export async function withRetry<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
  let lastError: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      lastError = e;
      if (!isTransient(e) || i === attempts - 1) throw e;
      await new Promise((r) => setTimeout(r, 500 * 2 ** i));
    }
  }
  throw lastError;
}

export async function ingest(params: {
  transcript: string;
  source: "voice" | "text";
  edited: boolean;
}): Promise<IngestResult> {
  const db = createSupabaseAdminClient();
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

  // 1. Durability first: record the raw entry before any AI/Notion call.
  const { data: entry, error: entryError } = await db
    .from("entries")
    .insert({
      source: params.source,
      raw_transcript: params.transcript,
      edited_transcript: params.edited ? params.transcript : null,
      status: "classifying",
    })
    .select()
    .single();
  if (entryError || !entry) {
    throw new Error(`Failed to record entry: ${entryError?.message}`);
  }

  const fail = async (message: string): Promise<IngestResult> => {
    await db.from("entries").update({ status: "error" }).eq("id", entry.id);
    return { entryId: entry.id, status: "error", filed: [], errors: [message], lowConfidence: false };
  };

  try {
    // 2. Load the live taxonomy.
    const { data: rows, error: taxError } = await db
      .from("destinations")
      .select("*, category:categories(*)")
      .eq("is_active", true);
    if (taxError || !rows?.length) {
      return await fail(
        taxError?.message ?? "No destinations found — run `npm run seed` first."
      );
    }
    const destinations = rows as unknown as DestinationWithCategory[];
    const catchAll = destinations.find((d) => d.category.slug === CATCH_ALL_SLUG) ?? null;

    // 3. Classify.
    const result = await classifyEntry({
      transcript: params.transcript,
      destinations,
      catchAllDestinationId: catchAll?.id ?? null,
    });

    await db.from("classification_runs").insert({
      entry_id: entry.id,
      model: result.model,
      prompt_version: PROMPT_VERSION,
      raw_response: result.raw,
      latency_ms: result.latencyMs,
      input_tokens: result.usage.input_tokens,
      output_tokens: result.usage.output_tokens,
      cache_read_tokens: result.usage.cache_read_input_tokens,
    });

    // 4. Write to Notion, one destination at a time; partial failures are recorded.
    const filed: IngestResult["filed"] = [];
    const errors: string[] = [];
    const embedItems: EmbedItem[] = [];
    const entryUrl = `${appUrl}/entries/${entry.id}`;

    const targets = result.classification.destinations.length
      ? result.classification.destinations
      : catchAll
        ? [
            {
              destination_id: catchAll.id,
              confidence: 0,
              formatted_title: params.transcript.slice(0, 80),
              formatted_body: params.transcript,
              development_prompts: [],
            },
          ]
        : [];

    for (const target of targets) {
      const dest = destinations.find((d) => d.id === target.destination_id);
      if (!dest) {
        errors.push(`Classifier referenced unknown destination ${target.destination_id}`);
        continue;
      }
      // Schema caps prompts at "0-3" in prose only (server-side length
      // constraints aren't supported), so enforce the cap here.
      const prompts = target.development_prompts?.slice(0, 3) ?? [];
      try {
        const write = await withRetry(() =>
          writeToDestination(dest, target.formatted_title, target.formatted_body, entryUrl, prompts)
        );
        const { data: fdRow, error: fdError } = await db
          .from("entry_destinations")
          .insert({
            entry_id: entry.id,
            destination_id: dest.id,
            action_type: dest.kind === "bank_database" ? "append_row" : "append_block",
            notion_page_id: write.notionPageId,
            notion_block_ids: write.notionBlockIds,
            content_snippet: `${target.formatted_title}${
              target.formatted_body ? ` — ${stripMarkdown(target.formatted_body)}` : ""
            }`,
            development_prompts: prompts.length ? prompts : null,
            warning: write.warning,
          })
          .select("id")
          .single();
        if (fdError || !fdRow) {
          // The Notion write succeeded, so a retry job would duplicate it.
          // Surface loudly instead — the page exists but isn't in the log.
          errors.push(
            `${dest.title}: filed to Notion but entry-log insert failed — ${
              fdError?.message ?? "no row returned"
            }`
          );
          continue;
        }
        embedItems.push({
          entryId: entry.id,
          entryDestinationId: fdRow.id,
          title: target.formatted_title,
          body: target.formatted_body,
        });
        filed.push({
          destinationTitle: dest.title,
          categoryName: dest.category.name,
          title: target.formatted_title,
          notionUrl: write.notionPageId ? notionUrl(write.notionPageId) : null,
          warning: write.warning,
        });
      } catch (e) {
        errors.push(`${dest.title}: ${e instanceof Error ? e.message : String(e)}`);
        // Queue for the background retry cron so the thought isn't lost.
        await db.from("job_queue").insert({
          job_type: "retry_notion_write",
          payload: {
            entry_id: entry.id,
            destination_id: dest.id,
            title: target.formatted_title,
            body: target.formatted_body,
            entry_url: entryUrl,
            development_prompts: prompts,
          },
          last_error: e instanceof Error ? e.message : String(e),
          run_after: new Date(Date.now() + 60_000).toISOString(),
        });
      }
    }

    // 4.5. Embed filed items for semantic search. Never blocks or fails the
    // filing — on error the batch goes to the retry queue instead.
    if (embedItems.length) {
      try {
        await embedFiledItems(db, embedItems);
      } catch (e) {
        await db.from("job_queue").insert({
          job_type: "embed_entry",
          payload: { items: embedItems },
          last_error: e instanceof Error ? e.message : String(e),
          run_after: new Date(Date.now() + 60_000).toISOString(),
        });
      }
    }

    // 5. Finalize entry status.
    const status: IngestResult["status"] =
      filed.length === 0 ? "error" : errors.length > 0 ? "partial_error" : "filed";
    await db.from("entries").update({ status }).eq("id", entry.id);

    return {
      entryId: entry.id,
      status,
      filed,
      errors,
      lowConfidence: result.classification.low_confidence,
    };
  } catch (e) {
    return await fail(e instanceof Error ? e.message : String(e));
  }
}
