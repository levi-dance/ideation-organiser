import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { writeToDestination } from "@/lib/notion/write";
import { stripMarkdown } from "@/lib/notion/markdown";
import { embedFiledItems, type EmbedItem } from "@/lib/pipeline/embed";
import {
  appendToTaskDescription,
  createTask,
  dumpStatus,
  getList,
} from "@/lib/clickup/client";
import type { DestinationWithCategory } from "@/lib/types";

export const maxDuration = 60;

const MAX_ATTEMPTS = 5;

type RetryPayload = {
  entry_id: string;
  destination_id: string;
  title: string;
  body: string;
  entry_url: string;
  development_prompts?: string[];
};

/** Vercel Cron target: retries queued Notion writes that failed during ingest. */
export async function GET(request: Request) {
  // Vercel sends Authorization: Bearer CRON_SECRET when the env var is set.
  const auth = request.headers.get("authorization");
  if (process.env.CRON_SECRET && auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = createSupabaseAdminClient();
  const { data: jobs } = await db
    .from("job_queue")
    .select("*")
    .eq("status", "queued")
    .eq("job_type", "retry_notion_write")
    .lte("run_after", new Date().toISOString())
    .limit(20);

  let succeeded = 0;
  let failed = 0;

  for (const job of jobs ?? []) {
    await db.from("job_queue").update({ status: "processing" }).eq("id", job.id);
    const payload = job.payload as RetryPayload;
    try {
      const { data: destRow } = await db
        .from("destinations")
        .select("*, category:categories(*)")
        .eq("id", payload.destination_id)
        .single();
      if (!destRow) throw new Error("destination no longer exists");
      const dest = destRow as unknown as DestinationWithCategory;

      const prompts = payload.development_prompts ?? [];
      const write = await writeToDestination(
        dest,
        payload.title,
        payload.body,
        payload.entry_url,
        prompts
      );
      const { data: fdRow, error: fdError } = await db
        .from("entry_destinations")
        .insert({
          entry_id: payload.entry_id,
          destination_id: dest.id,
          action_type: dest.kind === "bank_database" ? "append_row" : "append_block",
          notion_page_id: write.notionPageId,
          notion_block_ids: write.notionBlockIds,
          content_snippet: `${payload.title}${payload.body ? ` — ${stripMarkdown(payload.body)}` : ""}`,
          development_prompts: prompts.length ? prompts : null,
          warning: write.warning,
        })
        .select("id")
        .single();
      if (fdError) {
        // The Notion write succeeded — re-queuing would duplicate it. Fail the
        // job with a clear message instead.
        await db
          .from("job_queue")
          .update({
            status: "failed",
            last_error: `Notion write succeeded but entry-log insert failed: ${fdError.message}`,
          })
          .eq("id", job.id);
        failed++;
        continue;
      }
      await db.from("job_queue").update({ status: "done" }).eq("id", job.id);

      // Embed the recovered item; failures re-queue as their own embed job.
      if (fdRow) {
        const items: EmbedItem[] = [
          {
            entryId: payload.entry_id,
            entryDestinationId: fdRow.id,
            title: payload.title,
            body: payload.body,
          },
        ];
        try {
          await embedFiledItems(db, items);
        } catch (e) {
          await db.from("job_queue").insert({
            job_type: "embed_entry",
            payload: { items },
            last_error: e instanceof Error ? e.message : String(e),
            run_after: new Date(Date.now() + 60_000).toISOString(),
          });
        }
      }

      // If no queued retries remain for this entry, it is now fully filed.
      const { count } = await db
        .from("job_queue")
        .select("*", { count: "exact", head: true })
        .eq("status", "queued")
        .eq("job_type", "retry_notion_write")
        .eq("payload->>entry_id", payload.entry_id);
      if (!count) {
        await db.from("entries").update({ status: "filed" }).eq("id", payload.entry_id);
      }
      succeeded++;
    } catch (e) {
      const attempts = (job.attempts ?? 0) + 1;
      await db
        .from("job_queue")
        .update({
          status: attempts >= MAX_ATTEMPTS ? "failed" : "queued",
          attempts,
          last_error: e instanceof Error ? e.message : String(e),
          run_after: new Date(Date.now() + attempts * 3_600_000).toISOString(),
        })
        .eq("id", job.id);
      failed++;
    }
  }

  // Retry queued ClickUp writes (Work pathway). Same permission scope as
  // ingest: create task in dump status, or append to a description.
  const { data: clickupJobs } = await db
    .from("job_queue")
    .select("*")
    .eq("status", "queued")
    .eq("job_type", "retry_clickup_write")
    .lte("run_after", new Date().toISOString())
    .limit(20);

  for (const job of clickupJobs ?? []) {
    await db.from("job_queue").update({ status: "processing" }).eq("id", job.id);
    const p = job.payload as {
      entry_id: string;
      list_id: string;
      list_name: string;
      action: "create_task" | "append_description";
      task_id: string | null;
      title: string;
      body: string;
    };
    try {
      let taskId: string;
      let taskName: string;
      if (p.action === "append_description" && p.task_id) {
        const markdown = p.body ? `**${p.title}**\n\n${p.body}` : p.title;
        const res = await appendToTaskDescription(p.task_id, markdown);
        taskId = res.taskId;
        taskName = res.taskName;
      } else {
        const listMeta = await getList(p.list_id);
        const res = await createTask({
          listId: p.list_id,
          name: p.title,
          markdown: p.body,
          status: dumpStatus(listMeta),
        });
        taskId = res.taskId;
        taskName = p.title;
      }
      await db.from("clickup_actions").insert({
        entry_id: p.entry_id,
        list_id: p.list_id,
        list_name: p.list_name,
        action_type: p.action === "append_description" && p.task_id ? "append_description" : "create_task",
        task_id: taskId,
        task_name: taskName,
        content_snippet: `${p.title}${p.body ? ` — ${p.body}` : ""}`,
      });
      await db.from("job_queue").update({ status: "done" }).eq("id", job.id);

      // If no queued ClickUp retries remain for this entry, settle its status:
      // filed, or needs_routing if held ideas are still waiting.
      const { count: remaining } = await db
        .from("job_queue")
        .select("*", { count: "exact", head: true })
        .eq("status", "queued")
        .eq("job_type", "retry_clickup_write")
        .eq("payload->>entry_id", p.entry_id);
      if (!remaining) {
        const { count: heldCount } = await db
          .from("work_routing_queue")
          .select("*", { count: "exact", head: true })
          .eq("entry_id", p.entry_id)
          .eq("status", "queued");
        await db
          .from("entries")
          .update({ status: heldCount ? "needs_routing" : "filed" })
          .eq("id", p.entry_id);
      }
      succeeded++;
    } catch (e) {
      const attempts = (job.attempts ?? 0) + 1;
      await db
        .from("job_queue")
        .update({
          status: attempts >= MAX_ATTEMPTS ? "failed" : "queued",
          attempts,
          last_error: e instanceof Error ? e.message : String(e),
          run_after: new Date(Date.now() + attempts * 3_600_000).toISOString(),
        })
        .eq("id", job.id);
      failed++;
    }
  }

  // Drain queued embedding jobs (batches that failed during ingest).
  const { data: embedJobs } = await db
    .from("job_queue")
    .select("*")
    .eq("status", "queued")
    .eq("job_type", "embed_entry")
    .lte("run_after", new Date().toISOString())
    .limit(20);

  for (const job of embedJobs ?? []) {
    await db.from("job_queue").update({ status: "processing" }).eq("id", job.id);
    try {
      await embedFiledItems(db, (job.payload as { items: EmbedItem[] }).items);
      await db.from("job_queue").update({ status: "done" }).eq("id", job.id);
      succeeded++;
    } catch (e) {
      const attempts = (job.attempts ?? 0) + 1;
      await db
        .from("job_queue")
        .update({
          status: attempts >= MAX_ATTEMPTS ? "failed" : "queued",
          attempts,
          last_error: e instanceof Error ? e.message : String(e),
          run_after: new Date(Date.now() + attempts * 3_600_000).toISOString(),
        })
        .eq("id", job.id);
      failed++;
    }
  }

  return NextResponse.json({
    processed: (jobs ?? []).length + (clickupJobs ?? []).length + (embedJobs ?? []).length,
    succeeded,
    failed,
  });
}
