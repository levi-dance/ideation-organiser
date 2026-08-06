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

const ListDescriptionSchema = z.object({
  description: z
    .string()
    .describe(
      "One or two sentences telling a classifier what work belongs in this ClickUp list, and when useful what does not. Concrete and discriminating. No em dashes."
    ),
});

/**
 * Draft a routing description for a ClickUp list from its name and a sample of
 * the work already in it. Used by the Settings page as a starting point the
 * user edits, so a failure just means they write it themselves.
 */
export async function describeWorkList(params: {
  name: string;
  path: string;
  taskNames: string[];
}): Promise<string> {
  const client = new Anthropic();
  const response = await client.messages.parse({
    model: process.env.ANTHROPIC_MODEL || "claude-haiku-4-5",
    max_tokens: 512,
    system:
      "You write routing descriptions for a work task-filing system. Given a ClickUp list and a sample of tasks in it, write 1 to 2 sentences that help a classifier decide which captured thoughts belong in that list (and, when useful, what does NOT). Describe the kind of work, not the specific tasks. Be concrete. Never use em dashes.",
    messages: [
      {
        role: "user",
        content: [
          `list: ${params.name}`,
          `location: ${params.path}`,
          params.taskNames.length
            ? `tasks currently in it:\n${params.taskNames.map((t) => `- ${t}`).join("\n")}`
            : "the list is empty, so infer from its name and location",
        ].join("\n"),
      },
    ],
    output_config: { format: zodOutputFormat(ListDescriptionSchema) },
  });
  const description = response.parsed_output?.description?.trim();
  if (!description) throw new Error("No description came back");
  return description;
}

const CategoryDescriptionSchema = z.object({
  description: z
    .string()
    .describe(
      "Two or three sentences telling a classifier what belongs in this category and, when there is a near neighbour it could be confused with, what does not. Concrete and discriminating, grounded in what has actually been filed here. No em dashes."
    ),
});

/**
 * Draft a sharper routing description for one existing category, from its
 * place in the tree and a sample of what has actually been filed into it.
 * Used by the Settings page as a starting point the user edits, so a failure
 * just means they write it themselves.
 */
export async function describeCategoryFromFilings(params: {
  name: string;
  siblingNames: string[];
  destinationTitles: string[];
  filedTitles: string[];
  currentDescription: string;
}): Promise<string> {
  const client = new Anthropic();
  const response = await client.messages.parse({
    model: process.env.ANTHROPIC_MODEL || "claude-haiku-4-5",
    max_tokens: 512,
    system:
      "You write routing descriptions for a personal note-filing system. Given one category, the other categories it sits alongside, and a sample of what has actually been filed into it, write 2 to 3 sentences that help a classifier decide what belongs there. Ground it in the real filed examples rather than restating the name. When a sibling category could plausibly take the same thought, name that sibling and state the rule that separates them. Never use em dashes.",
    messages: [
      {
        role: "user",
        content: [
          `category: ${params.name}`,
          params.currentDescription
            ? `its current description, which you are improving on:\n${params.currentDescription}`
            : "it has no description yet",
          params.destinationTitles.length
            ? `places it files into: ${params.destinationTitles.join(", ")}`
            : "",
          params.siblingNames.length
            ? `other categories in this second brain: ${params.siblingNames.join(", ")}`
            : "",
          params.filedTitles.length
            ? `recently filed here:\n${params.filedTitles.map((t) => `- ${t}`).join("\n")}`
            : "nothing has been filed here yet, so infer from the name and the places it files into",
        ]
          .filter(Boolean)
          .join("\n\n"),
      },
    ],
    output_config: { format: zodOutputFormat(CategoryDescriptionSchema) },
  });
  const description = response.parsed_output?.description?.trim();
  if (!description) throw new Error("No description came back");
  return description;
}

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
