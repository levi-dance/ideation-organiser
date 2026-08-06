/**
 * Turn a paragraph about someone's life and work into a proposed second-brain
 * structure: categories, and the concrete Notion destinations under each.
 *
 * This is a proposal only. Nothing is created until the user has edited it and
 * confirmed, so the model is asked to be opinionated rather than cautious: a
 * concrete tree is far easier to correct than a blank page is to fill.
 */
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";

/** Nesting is capped so the proposal stays reviewable in one screen. */
export const MAX_DEPTH = 2;

const ProposedDestinationSchema = z.object({
  title: z.string().describe("What this filing target is called, e.g. \"Article Ideas\""),
  kind: z
    .enum(["bank_database", "document_section"])
    .describe(
      "bank_database for a growing list of separate items (ideas, groceries, books, client notes). document_section for one long-lived document that new thoughts get appended into, such as a draft being written right now. Use bank_database unless the user described an actual document in progress."
    ),
  section_heading: z
    .string()
    .describe(
      "For document_section only: the heading inside that document new thoughts land under, e.g. \"Notes\". Empty string for bank_database, or when appending at the end of the document is fine."
    ),
  dedup_enabled: z
    .boolean()
    .describe(
      "True only for list destinations where the same thing said twice should merge rather than repeat: groceries, shopping, books to read, gear wishlists. False for anything idea-shaped."
    ),
});

const ProposedCategorySchema = z.object({
  key: z
    .string()
    .describe("Short unique identifier for this category within this proposal, lowercase with hyphens"),
  name: z.string().describe("What the user would call this area of their life or work"),
  description: z
    .string()
    .describe(
      "Two or three sentences telling a classifier exactly what belongs here and, when there is a near neighbour it could be confused with, what does NOT. Concrete and specific to this person. No em dashes."
    ),
  parent_key: z
    .string()
    .describe("The key of the parent category, or an empty string for a top-level category"),
  is_catch_all: z
    .boolean()
    .describe(
      "True for exactly one category: the landing zone for thoughts that fit nothing else. Give it exactly one bank_database destination."
    ),
  destinations: z
    .array(ProposedDestinationSchema)
    .describe(
      "The concrete places thoughts in this category get filed. A category that exists only to group other categories has an empty array; every other category needs at least one."
    ),
});

const ProposalSchema = z.object({
  categories: z.array(ProposedCategorySchema),
});

export type ProposedDestination = z.infer<typeof ProposedDestinationSchema>;
export type ProposedCategory = z.infer<typeof ProposedCategorySchema>;
export type TaxonomyProposal = z.infer<typeof ProposalSchema>;

const SYSTEM_PROMPT = `You design the filing structure for one person's "second brain". They describe their life and work in their own words; you propose the categories they will file captured thoughts into, and the concrete destinations under each.

What the structure is made of:
- A category is an area of their life. Its description is the only thing a classifier reads when deciding where a thought goes, so it carries all the weight.
- A destination is a real place content lands. bank_database is a Notion database that collects separate items, one row each. document_section is a single Notion page that thoughts get appended into, for a piece of writing actively in progress.

Rules:
- Propose between 6 and 12 categories. Enough to be useful on day one, few enough to read in one sitting.
- Nest at most two levels deep. Use a parent only when the person genuinely has several parallel things of the same type (several clients, several content channels). A parent that groups children has no destinations of its own.
- Every category that is not a pure grouping parent needs at least one destination. Most need exactly one.
- Include exactly one catch-all category for thoughts that fit nothing else, with is_catch_all true and one bank_database destination.
- Ground every name in what the person actually said. If they named clients, projects, or channels, use those real names. Do not invent a life they did not describe, and do not pad the tree with generic areas they never mentioned.
- Descriptions must discriminate. When two categories could plausibly take the same thought, say so in both: name the neighbour and state the rule that separates them. The classic case is work for a client versus the person's own content, where an idea "for a client's Instagram" belongs to the client, not to the person's own Instagram bank.
- Prefer bank_database. Only propose document_section when they described a specific document or draft they are writing right now.
- Set dedup_enabled only on genuine shopping-style lists.
- Never use em dashes anywhere in your output. Use commas, colons, or separate sentences.`;

export async function proposeTaxonomy(params: {
  about: string;
  /** What the user disliked about the previous proposal, when regenerating. */
  feedback?: string | null;
}): Promise<{ proposal: TaxonomyProposal; model: string }> {
  const client = new Anthropic();
  const model = process.env.ANTHROPIC_MODEL || "claude-haiku-4-5";

  const content = [`Here is how they describe their life and work:\n\n"""${params.about}"""`];
  if (params.feedback?.trim()) {
    content.push(
      `You proposed a structure already and they want it changed. Their notes:\n\n"""${params.feedback.trim()}"""\n\nPropose the whole structure again with those notes applied.`
    );
  }

  const response = await client.messages.parse({
    model,
    max_tokens: 8192,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: content.join("\n\n") }],
    output_config: { format: zodOutputFormat(ProposalSchema) },
  });

  const proposal = response.parsed_output;
  if (!proposal?.categories?.length) {
    throw new Error("The model did not return a usable structure. Try describing your work again.");
  }
  return { proposal: normalize(proposal), model };
}

/**
 * Repair the proposal into something the editor can always render: unique keys,
 * no parent cycles or dangling parents, depth within the cap, and exactly one
 * catch-all. The user can still break these while editing, which is why the
 * build endpoint validates independently; this only keeps a bad generation from
 * reaching the UI as an empty or looping tree.
 */
function normalize(proposal: TaxonomyProposal): TaxonomyProposal {
  const seenKeys = new Set<string>();
  const categories = proposal.categories.map((c, i) => {
    let key = c.key?.trim() || `category-${i + 1}`;
    for (let n = 2; seenKeys.has(key); n++) key = `${c.key || "category"}-${n}`;
    seenKeys.add(key);
    return { ...c, key, name: c.name.trim(), description: c.description.trim() };
  });

  const byKey = new Map(categories.map((c) => [c.key, c]));
  const depthOf = (c: ProposedCategory): number => {
    let depth = 1;
    const seen = new Set<string>([c.key]);
    let parent = c.parent_key ? byKey.get(c.parent_key) : undefined;
    while (parent && !seen.has(parent.key)) {
      seen.add(parent.key);
      depth++;
      parent = parent.parent_key ? byKey.get(parent.parent_key) : undefined;
    }
    return depth;
  };

  for (const c of categories) {
    // A parent that does not exist, is the category itself, or would push it
    // past the depth cap becomes no parent at all.
    if (c.parent_key && (!byKey.has(c.parent_key) || c.parent_key === c.key)) c.parent_key = "";
    if (c.parent_key && depthOf(c) > MAX_DEPTH) c.parent_key = "";
  }

  // Exactly one catch-all, or the classifier has nowhere to put a stray thought.
  const catchAlls = categories.filter((c) => c.is_catch_all);
  for (const c of catchAlls.slice(1)) c.is_catch_all = false;
  if (!catchAlls.length) {
    categories.push({
      key: "general-notes",
      name: "General Notes",
      description:
        "Catch-all for learnings, thoughts, and notes that do not fit any more specific destination.",
      parent_key: "",
      is_catch_all: true,
      destinations: [
        {
          title: "General Notes",
          kind: "bank_database",
          section_heading: "",
          dedup_enabled: false,
        },
      ],
    });
  }

  return { categories };
}
