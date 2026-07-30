import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import type { DestinationWithCategory } from "@/lib/types";

export const PROMPT_VERSION = "v4";

const ClassificationSchema = z.object({
  destinations: z
    .array(
      z.object({
        destination_id: z.string().describe("The id of an existing destination from the taxonomy"),
        confidence: z.number().describe("0 to 1 confidence that this destination fits"),
        formatted_title: z
          .string()
          .describe("Short, clean title for the filed item (a few words, not the raw transcript)"),
        formatted_body: z
          .string()
          .describe(
            "Cleaned-up body preserving the full idea. Fix speech-to-text artifacts. Empty string if the title alone captures it (e.g. a grocery item). When the content genuinely has structure, use lightweight Markdown: #/##/### headings, - bullets, 1. numbered lists, > quotes, **bold**, *italic*. Short simple captures stay plain prose; never add structure the thought doesn't have. Never use tables, images, code fences, or nested lists. Never use em dashes; use commas, colons, or separate sentences instead."
          ),
        development_prompts: z
          .array(z.string())
          .describe(
            "0-3 short, concrete questions that would push this idea forward. ONLY when the idea is promising but thin or underdeveloped. Empty array for groceries, list items, complete thoughts, and routine notes. Never use em dashes."
          ),
      })
    )
    .describe(
      "One element per distinct idea per destination. A capture may contain several unrelated ideas; emit each as its own element with its own title and body, even when several land in the same destination. Grocery-style entries may produce several items; emit one destination element per item."
    ),
  low_confidence: z
    .boolean()
    .describe("True if no destination was a confident fit and the catch-all was used"),
});

export type Classification = z.infer<typeof ClassificationSchema>;

function renderTaxonomy(destinations: DestinationWithCategory[]): string {
  return destinations
    .map((d) => {
      const lines = [
        `- destination_id: ${d.id}`,
        `  title: ${d.title}`,
        `  category: ${d.category.name} (${d.category.slug})`,
        `  kind: ${d.kind}`,
        `  description: ${d.category.description}`,
      ];
      if (d.summary) lines.push(`  recent_summary: ${d.summary}`);
      if (d.is_current_focus) lines.push(`  note: this is the CURRENT FOCUS for its category`);
      return lines.join("\n");
    })
    .join("\n");
}

export const SYSTEM_PROMPT = `You are the filing engine of a personal "second brain". The user captures raw thoughts by voice or text; you route each one to the right destination(s) and clean it up for filing.

Rules:
- Choose the most specific destination(s) that confidently fit. An entry can be filed to multiple destinations when it is genuinely relevant to each (e.g. a draft thought about family may belong in both the current draft and a family bank).
- Client work vs personal content: an idea "for <client>" belongs under that client's destinations, NOT under the user's own content-idea banks, even if it mentions a platform like Instagram or YouTube.
- List-style entries (groceries) may contain several items in one capture; emit one destination element per item, each with its own short title.
- Clean up speech-to-text artifacts, filler words, and false starts, but NEVER lose or alter the substance of the idea.
- If nothing fits confidently, use the catch-all destination and set low_confidence to true.
- formatted_title is a short label; formatted_body carries the full idea (may be empty for simple list items).
- Never use em dashes in titles or bodies. Use commas, colons, or separate sentences.

Splitting a capture into ideas:
- Treat every capture as potentially a multi-idea ramble. A distinct idea is one that could stand alone as its own note with its own title: a different topic, project, or intent. Emit one destinations element per distinct idea.
- Do NOT fragment a single coherent thought. Supporting details, examples, reasons, and elaborations belong in the body of the idea they support; a thought plus its justification is ONE idea. When unsure, keep it together.
- Splitting and multi-destination filing are orthogonal: first separate the distinct ideas, then file each idea into its destination(s). Example: "grab almond milk, oh and an idea for the article about why simple tools win" is TWO ideas: one grocery element, one article element.

Formatting the body:
- Most captures are plain prose; keep them that way. Only when a ramble has genuinely distinct parts (several points, a clear outline) render formatted_body as lightweight Markdown: a short intro then - bullets, or ##/### headings for longer multi-part ideas. **bold** for the key phrase is fine. Never invent structure, and never use tables, images, code fences, or nested lists.

Development prompts:
- When an idea is promising but underdeveloped (a spark without a plan), add 1-3 short, concrete questions in development_prompts that would push it forward (e.g. "What's the visual for this?", "What's the opening line?").
- Most captures need none: groceries, list items, complete thoughts, and routine notes always get an empty array.`;

export async function classifyEntry(params: {
  transcript: string;
  destinations: DestinationWithCategory[];
  catchAllDestinationId: string | null;
  customInstructions?: string | null;
}): Promise<{
  classification: Classification;
  model: string;
  latencyMs: number;
  usage: { input_tokens: number; output_tokens: number; cache_read_input_tokens: number | null };
  raw: unknown;
}> {
  const client = new Anthropic();
  const model = process.env.ANTHROPIC_MODEL || "claude-haiku-4-5";

  const taxonomyBlock = `Current taxonomy (all active destinations):\n\n${renderTaxonomy(
    params.destinations
  )}\n\nCatch-all destination_id: ${params.catchAllDestinationId ?? "none"}`;

  const started = Date.now();
  const response = await client.messages.parse({
    model,
    max_tokens: 4096,
    system: [
      { type: "text", text: SYSTEM_PROMPT },
      // Owner's compiled standing instructions (see /instructions). Placed
      // before the cached taxonomy block so the whole prefix stays cacheable.
      ...(params.customInstructions
        ? [
            {
              type: "text" as const,
              text: `Owner's standing instructions, compiled from their own words. When these conflict with a category description or a general rule above, the standing instructions win:\n\n${params.customInstructions}`,
            },
          ]
        : []),
      // Taxonomy changes rarely; cache it as part of the stable prefix.
      { type: "text", text: taxonomyBlock, cache_control: { type: "ephemeral" } },
    ],
    messages: [
      {
        role: "user",
        content: `New capture to file:\n\n"""${params.transcript}"""`,
      },
    ],
    output_config: { format: zodOutputFormat(ClassificationSchema) },
  });
  const latencyMs = Date.now() - started;

  if (!response.parsed_output) {
    throw new Error("Classification returned no parseable output");
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
