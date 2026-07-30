import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";

const DescriptionsSchema = z.object({
  categories: z.array(
    z.object({
      id: z.string().describe("The category id, echoed back unchanged"),
      description: z
        .string()
        .describe(
          "One or two sentences telling a classifier what belongs in this category: concrete and discriminating, not generic. No em dashes."
        ),
    })
  ),
});

/**
 * Write concise routing descriptions for newly discovered categories.
 * Falls back to a template if the call fails - sync must not break on this.
 */
export async function describeCategories(
  categories: { id: string; name: string; parentName: string | null }[]
): Promise<{ id: string; description: string }[]> {
  const fallback = categories.map((c) => ({
    id: c.id,
    description: `Notes and items related to "${c.name}"${
      c.parentName ? ` (under ${c.parentName})` : ""
    }.`,
  }));
  try {
    const client = new Anthropic();
    const response = await client.messages.parse({
      model: process.env.ANTHROPIC_MODEL || "claude-haiku-4-5",
      max_tokens: 2048,
      system:
        "You write routing descriptions for a personal note-filing system. For each category, write 1 to 2 sentences that help a classifier decide what belongs there (and, when useful, what does NOT). Be concrete. Never use em dashes.",
      messages: [
        {
          role: "user",
          content: categories
            .map((c) => `- id: ${c.id}\n  name: ${c.name}\n  parent: ${c.parentName ?? "(top level)"}`)
            .join("\n"),
        },
      ],
      output_config: { format: zodOutputFormat(DescriptionsSchema) },
    });
    const out = response.parsed_output?.categories;
    if (!out?.length) return fallback;
    const valid = new Set(categories.map((c) => c.id));
    return out.filter((c) => valid.has(c.id));
  } catch {
    return fallback;
  }
}
