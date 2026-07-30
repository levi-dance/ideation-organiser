import { createSupabaseAdminClient } from "@/lib/supabase/server";
import {
  classifyWorkEntry,
  WORK_PROMPT_VERSION,
  LIST_CONFIDENCE_MIN,
  APPEND_CONFIDENCE_MIN,
} from "@/lib/claude/classify-work";
import { workLists, type ResolvedWorkList } from "@/lib/clickup/lists";
import {
  appendToTaskDescription,
  createTask,
  dumpStatus,
  getList,
  getListTasks,
  type ClickUpTask,
} from "@/lib/clickup/client";
import { withRetry } from "@/lib/pipeline/ingest";

export type WorkIngestResult = {
  entryId: string;
  status: "filed" | "partial_error" | "error" | "needs_routing";
  filed: {
    listName: string;
    action: "create_task" | "append_description";
    title: string;
    taskUrl: string;
  }[];
  held: { title: string; reason: string }[];
  errors: string[];
};

/**
 * The Work pathway: capture → ClickUp. Mirrors ingest() but is a separate
 * module so the Notion pathway stays untouched.
 *
 * Permission scope (enforced in lib/clickup/client.ts): read tasks, create
 * tasks in a list's dump status, append to descriptions. Nothing else.
 * Low list confidence → the idea is HELD in work_routing_queue for manual
 * routing; nothing is written to ClickUp for it.
 */
export async function ingestWork(params: {
  transcript: string;
  source: "voice" | "text";
  edited: boolean;
}): Promise<WorkIngestResult> {
  const db = createSupabaseAdminClient();

  // 1. Durability first: record the raw entry before any AI/ClickUp call.
  const { data: entry, error: entryError } = await db
    .from("entries")
    .insert({
      source: params.source,
      scope: "work",
      raw_transcript: params.transcript,
      edited_transcript: params.edited ? params.transcript : null,
      status: "classifying",
    })
    .select()
    .single();
  if (entryError || !entry) {
    throw new Error(`Failed to record entry: ${entryError?.message}`);
  }

  const fail = async (message: string): Promise<WorkIngestResult> => {
    await db.from("entries").update({ status: "error" }).eq("id", entry.id);
    return { entryId: entry.id, status: "error", filed: [], held: [], errors: [message] };
  };

  try {
    // 2. Load the lists and their open tasks (routing context + append targets).
    const lists = workLists();
    if (!lists.length) {
      return await fail("No ClickUp lists configured — set CLICKUP_LISTS (see README).");
    }
    const tasksByList = new Map<string, ClickUpTask[]>();
    await Promise.all(
      lists.map(async (l) => {
        tasksByList.set(l.listId, await getListTasks(l.listId));
      })
    );

    // 3. Classify.
    const result = await classifyWorkEntry({
      transcript: params.transcript,
      lists,
      tasksByList,
    });

    await db.from("classification_runs").insert({
      entry_id: entry.id,
      model: result.model,
      prompt_version: WORK_PROMPT_VERSION,
      raw_response: result.raw,
      latency_ms: result.latencyMs,
      input_tokens: result.usage.input_tokens,
      output_tokens: result.usage.output_tokens,
      cache_read_tokens: result.usage.cache_read_input_tokens,
    });

    // 4. File each idea: create, append, or hold.
    const filed: WorkIngestResult["filed"] = [];
    const held: WorkIngestResult["held"] = [];
    const errors: string[] = [];
    const listByKey = new Map<string, ResolvedWorkList>(lists.map((l) => [l.key, l]));

    for (const idea of result.classification.ideas) {
      const list = idea.list_key ? listByKey.get(idea.list_key) : undefined;

      // Hold for manual routing when the classifier isn't confident. Never guess.
      if (!list || idea.list_confidence < LIST_CONFIDENCE_MIN) {
        const reason =
          idea.reason ||
          (list ? "List confidence too low" : "No list was a confident fit");
        await db.from("work_routing_queue").insert({
          entry_id: entry.id,
          title: idea.formatted_title,
          body: idea.formatted_body,
          candidate_list_id: list?.listId ?? null,
          reason,
        });
        held.push({ title: idea.formatted_title, reason });
        continue;
      }

      const knownTask = idea.matched_task_id
        ? (tasksByList.get(list.listId) ?? []).find((t) => t.id === idea.matched_task_id)
        : undefined;
      const shouldAppend = !!knownTask && idea.match_confidence >= APPEND_CONFIDENCE_MIN;

      try {
        if (shouldAppend) {
          const markdown = idea.formatted_body
            ? `**${idea.formatted_title}**\n\n${idea.formatted_body}`
            : idea.formatted_title;
          const res = await withRetry(() =>
            appendToTaskDescription(knownTask.id, markdown)
          );
          await db.from("clickup_actions").insert({
            entry_id: entry.id,
            list_id: list.listId,
            list_name: list.name,
            action_type: "append_description",
            task_id: res.taskId,
            task_name: res.taskName,
            content_snippet: `${idea.formatted_title}${
              idea.formatted_body ? ` — ${idea.formatted_body}` : ""
            }`,
          });
          filed.push({
            listName: list.name,
            action: "append_description",
            title: idea.formatted_title,
            taskUrl: res.url,
          });
        } else {
          // New tasks land in the list's first/dump status — filing, not triage.
          const listMeta = await withRetry(() => getList(list.listId));
          const res = await withRetry(() =>
            createTask({
              listId: list.listId,
              name: idea.formatted_title,
              markdown: idea.formatted_body,
              status: dumpStatus(listMeta),
            })
          );
          await db.from("clickup_actions").insert({
            entry_id: entry.id,
            list_id: list.listId,
            list_name: list.name,
            action_type: "create_task",
            task_id: res.taskId,
            task_name: idea.formatted_title,
            content_snippet: `${idea.formatted_title}${
              idea.formatted_body ? ` — ${idea.formatted_body}` : ""
            }`,
          });
          filed.push({
            listName: list.name,
            action: "create_task",
            title: idea.formatted_title,
            taskUrl: res.url,
          });
        }
      } catch (e) {
        errors.push(`${list.name}: ${e instanceof Error ? e.message : String(e)}`);
        // Queue for the background retry cron so the thought isn't lost.
        // Appends retry as creates-or-appends re-decided at retry time would
        // need fresh matching; keep it simple and retry the same action.
        await db.from("job_queue").insert({
          job_type: "retry_clickup_write",
          payload: {
            entry_id: entry.id,
            list_id: list.listId,
            list_name: list.name,
            action: shouldAppend ? "append_description" : "create_task",
            task_id: shouldAppend ? knownTask.id : null,
            title: idea.formatted_title,
            body: idea.formatted_body,
          },
          last_error: e instanceof Error ? e.message : String(e),
          run_after: new Date(Date.now() + 60_000).toISOString(),
        });
      }
    }

    // 5. Finalize entry status. Errors outrank holds outrank clean filings.
    if (!filed.length && !held.length && !errors.length) {
      errors.push("Classifier returned no ideas for this capture");
    }
    const status: WorkIngestResult["status"] =
      filed.length === 0 && held.length === 0
        ? "error"
        : errors.length > 0
          ? "partial_error"
          : held.length > 0
            ? "needs_routing"
            : "filed";
    await db.from("entries").update({ status }).eq("id", entry.id);

    return { entryId: entry.id, status, filed, held, errors };
  } catch (e) {
    return await fail(e instanceof Error ? e.message : String(e));
  }
}
