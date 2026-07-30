import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import type { ResolvedWorkList } from "@/lib/clickup/lists";
import type { ClickUpTask } from "@/lib/clickup/client";

export const WORK_PROMPT_VERSION = "work-v1";

/**
 * Confidence gates. Deliberately conservative:
 * - Below LIST_CONFIDENCE_MIN the idea is HELD for manual routing, not filed.
 * - Appending to an existing task requires a very high match — a wrong append
 *   pollutes a real task, while a duplicate new task is cheap to merge later.
 */
export const LIST_CONFIDENCE_MIN = 0.6;
export const APPEND_CONFIDENCE_MIN = 0.9;

const WorkClassificationSchema = z.object({
  ideas: z
    .array(
      z.object({
        list_key: z
          .string()
          .nullable()
          .describe("The key of the best-fitting list, or null if none fits confidently"),
        list_confidence: z.number().describe("0 to 1 confidence that the chosen list is right"),
        matched_task_id: z
          .string()
          .nullable()
          .describe(
            "The id of an existing task this idea adds detail to, or null if it is a genuinely new idea"
          ),
        match_confidence: z
          .number()
          .describe(
            "0 to 1 confidence that this idea belongs on the matched task. Only meaningful when matched_task_id is set."
          ),
        formatted_title: z
          .string()
          .describe("Short, clean task-style title (a few words, not the raw transcript)"),
        formatted_body: z
          .string()
          .describe(
            "Cleaned-up body preserving the full idea. Fix speech-to-text artifacts. Empty string if the title alone captures it. Plain prose unless the thought genuinely has structure; then lightweight Markdown (- bullets, **bold**). Never tables, images, or code fences."
          ),
        reason: z
          .string()
          .describe("One short sentence on why this list (or why no list / why this match)"),
      })
    )
    .describe("One element per distinct work idea in the capture"),
});

export type WorkClassification = z.infer<typeof WorkClassificationSchema>;

function renderLists(
  lists: ResolvedWorkList[],
  tasksByList: Map<string, ClickUpTask[]>
): string {
  return lists
    .map((l) => {
      const tasks = tasksByList.get(l.listId) ?? [];
      const taskLines = tasks.length
        ? tasks.map((t) => `    - task_id: ${t.id} | ${t.name}`).join("\n")
        : "    (no open tasks)";
      return [
        `- list_key: ${l.key}`,
        `  name: ${l.name}`,
        `  purpose: ${l.description}`,
        `  open tasks:`,
        taskLines,
      ].join("\n");
    })
    .join("\n");
}

const SYSTEM_PROMPT = `You are the work-idea filing engine of a personal "second brain". The user captures raw work thoughts by voice or text and has already marked them as Work; you route each one to the right ClickUp list and decide whether it is a new idea or added detail on an existing task.

Rules:
- Choose ONE list per idea — the one whose purpose best fits. Do not force a fit: if no list is a confident match, set list_key to null and explain why in reason. It is always better to hold an idea for manual routing than to file it somewhere wrong.
- Your job is filing, NOT triage: never prioritize, categorize, or editorialize. Clean up speech-to-text artifacts and filler words, but NEVER lose or alter the substance of the idea.
- Append vs. create: scan the list's open tasks. If the idea clearly adds detail to an existing task (a new thought on a reel idea that is already a task, for example), set matched_task_id with an honest match_confidence. Matching means the SAME piece of work — not merely the same topic or platform. When in doubt, it is a new task; duplicates are cheap, wrong appends are not.
- A capture may contain several distinct work ideas — emit one element per idea. Do not fragment a single coherent thought; supporting details belong in the body of the idea they support.`;

export async function classifyWorkEntry(params: {
  transcript: string;
  lists: ResolvedWorkList[];
  tasksByList: Map<string, ClickUpTask[]>;
}): Promise<{
  classification: WorkClassification;
  model: string;
  latencyMs: number;
  usage: { input_tokens: number; output_tokens: number; cache_read_input_tokens: number | null };
  raw: unknown;
}> {
  const client = new Anthropic();
  const model = process.env.ANTHROPIC_MODEL || "claude-haiku-4-5";

  const listsBlock = `ClickUp lists and their current open tasks:\n\n${renderLists(
    params.lists,
    params.tasksByList
  )}`;

  const started = Date.now();
  const response = await client.messages.parse({
    model,
    max_tokens: 4096,
    system: [
      { type: "text", text: SYSTEM_PROMPT },
      // Task lists change slowly relative to capture bursts; cache the prefix.
      { type: "text", text: listsBlock, cache_control: { type: "ephemeral" } },
    ],
    messages: [
      {
        role: "user",
        content: `New work capture to file:\n\n"""${params.transcript}"""`,
      },
    ],
    output_config: { format: zodOutputFormat(WorkClassificationSchema) },
  });
  const latencyMs = Date.now() - started;

  if (!response.parsed_output) {
    throw new Error("Work classification returned no parseable output");
  }

  return {
    classification: response.parsed_output,
    model,
    latencyMs,
    usage: {
      input_tokens: response.usage.input_tokens,
      output_tokens: response.usage.output_tokens,
      cache_read_input_tokens: response.usage.cache_read_input_tokens ?? null,
    },
    raw: response.parsed_output,
  };
}
