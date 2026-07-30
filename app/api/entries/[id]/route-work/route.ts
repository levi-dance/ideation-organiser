import { NextResponse } from "next/server";
import { createSupabaseAdminClient, createSupabaseServerClient } from "@/lib/supabase/server";
import { workLists } from "@/lib/clickup/lists";
import { formatSnippet } from "@/lib/pipeline/snippet";
import { createTask, dumpStatus, getList } from "@/lib/clickup/client";
import { withRetry } from "@/lib/pipeline/ingest";
import type { WorkRoutingQueueItem } from "@/lib/types";

export const maxDuration = 60;

/**
 * Manually route a held Work idea into a ClickUp list. This is the resolution
 * path for work_routing_queue items - the owner picks the list, the system
 * files the task (same permission scope as ingest: create in dump status only).
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: entryId } = await params;
  const body = await request.json().catch(() => null);
  const queueItemId = typeof body?.queueItemId === "string" ? body.queueItemId : "";
  const listId = typeof body?.listId === "string" ? body.listId : "";
  if (!queueItemId || !listId) {
    return NextResponse.json({ error: "queueItemId and listId are required" }, { status: 400 });
  }

  const list = workLists().find((l) => l.listId === listId);
  if (!list) {
    return NextResponse.json({ error: "Unknown ClickUp list" }, { status: 400 });
  }

  const db = createSupabaseAdminClient();
  const { data: item } = await db
    .from("work_routing_queue")
    .select("*")
    .eq("id", queueItemId)
    .eq("entry_id", entryId)
    .single<WorkRoutingQueueItem>();
  if (!item) {
    return NextResponse.json({ error: "Queue item not found" }, { status: 404 });
  }
  if (item.status !== "queued") {
    return NextResponse.json({ error: `Already ${item.status}` }, { status: 409 });
  }

  try {
    const listMeta = await withRetry(() => getList(list.listId));
    const res = await withRetry(() =>
      createTask({
        listId: list.listId,
        name: item.title,
        markdown: item.body,
        status: dumpStatus(listMeta),
      })
    );
    await db.from("clickup_actions").insert({
      entry_id: entryId,
      list_id: list.listId,
      list_name: list.name,
      action_type: "create_task",
      task_id: res.taskId,
      task_name: item.title,
      content_snippet: formatSnippet(item.title, item.body),
    });
    await db.from("work_routing_queue").update({ status: "routed" }).eq("id", item.id);

    // Entry is fully filed once no queued items remain.
    const { count } = await db
      .from("work_routing_queue")
      .select("*", { count: "exact", head: true })
      .eq("entry_id", entryId)
      .eq("status", "queued");
    if (!count) {
      await db.from("entries").update({ status: "filed" }).eq("id", entryId);
    }

    return NextResponse.json({ ok: true, taskUrl: res.url, listName: list.name });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "routing failed" },
      { status: 500 }
    );
  }
}
