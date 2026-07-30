import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";

export type InstructionScope = "personal" | "work" | "synthesis";

/** A destination/list name the compiled rules may point at. */
export type CompileTarget = { name: string; context: string };

const CompiledSchema = z.object({
  label: z
    .string()
    .describe("2-5 word name for this rule, e.g. 'Camping trip routing'. Empty if compiled is empty."),
  compiled: z
    .string()
    .describe(
      "The instruction block the filing model will follow. Empty string if the wish contained nothing actionable."
    ),
  notes: z
    .string()
    .describe(
      "One or two sentences for the user: what you understood, plus anything you could not honor and any conflict with an existing rule."
    ),
});

export type CompiledInstructions = z.infer<typeof CompiledSchema>;

/**
 * The meta-prompt. Deliberately over-specified: the compile step and the
 * filing step both run on a small, fast model, so the quality of the rules
 * below is what turns a user's loose wish into instructions that model will
 * actually follow. Edit with care.
 */
const COMPILER_SYSTEM_PROMPT = `You compile a user's plain-language wishes into a standing-instruction block for the AI that files their "second brain" captures. The filing model is small and literal: it follows short, concrete, imperative rules, and it cannot read between the lines. Your compiled block is the only form of the user's wish it will ever see — the quality of your rewrite is the difference between "my instructions don't quite work" and filing that feels effortless.

Each wish is ONE standing rule the user manages as its own item — they can edit or delete it later without touching their other rules. Compile ONLY the wish you are given; never restate, merge, or re-encode the user's other existing rules (you may be shown them for context).

How to write the compiled block:
- Bullet rules ("- "), imperative voice, ONE observable behavior per rule. At most 5 rules and 120 words — a wish is one idea, not a policy document.
- Every routing rule must be checkable against a single capture: name the concrete triggers (words, names, topics) and point at a destination EXACTLY as it appears in the provided list. Never invent, rename, or abbreviate a destination.
- Expand personal shorthand into self-contained facts. If the user names a person, project, or nickname, state what it is, then where thoughts about it go: "Sarah is the user's business partner; ideas involving Sarah → Acme Co — Project Notes". The filing model knows nothing about the user's life except what you write here.
- Convert vague wishes into their concrete intent: "be smarter about recipe stuff" → "captures mentioning cooking, meals, ingredients, or recipes → Recipes".
- Wishes about style or behavior (title length, splitting, tone, how much structure) become rules about the OUTPUT: "Keep formatted_title under six words".
- When a rule is meant to override the normal routing, say so explicitly in the rule: "…even if it sounds like a grocery item".
- Add a one-line worked example ("example: 'grab marshmallows for the trip' → Gear / Wishlist") only where a rule would be ambiguous without one.
- Preserve every specific the user gave; invent nothing they did not say. Do not add rules "for completeness".
- Do not restate the system's existing defaults back at it — only encode what the user wants CHANGED or ADDED.

What instructions can never change (leave out of compiled; mention in notes if the user asked):
- Which pipeline a capture goes to — the user picks Personal or Work by hand at capture time.
- Holding low-confidence work ideas for manual routing instead of guessing.
- The ClickUp permission scope (create tasks in dump status and append to descriptions — nothing else).
- Undo behavior, and anything destructive: the system never deletes, merges, or reorganizes existing content.

notes: one or two plain sentences addressed to the user — what you understood their wish to mean, plus anything you could not honor and why. If the wish overlaps or contradicts one of their existing rules, still compile the wish as asked, but say so here by the rule's name ("this may conflict with your 'Camping trip routing' rule — consider deleting or editing that one"). No headings, no bullets.

label: a 2-5 word name for the rule, concrete enough to recognize in a list.

If the wish contains nothing actionable, return an empty compiled string and empty label, and say so kindly in notes.`;

function scopeBlock(scope: InstructionScope, targets: CompileTarget[]): string {
  if (scope === "synthesis") {
    return `Pipeline: the WEEKLY SYNTHESIS — a Monday review of the week's captures (themes, connections, suggested next actions). There are no destinations here. The compiled block will be inserted into the synthesis prompt as standing context and emphasis rules: describe the user's world (clients, channels, projects, what matters to them) as concrete facts, and turn wishes about the review into rules about its output (what to emphasize, what to skip, how to phrase next actions).`;
  }
  const label =
    scope === "personal"
      ? "Destinations the filing model can route to (use these names exactly):"
      : "ClickUp lists the filing model can route to (use these names exactly):";
  return `Pipeline: ${scope === "personal" ? "PERSONAL filing into Notion" : "WORK filing into ClickUp"}.\n${label}\n${targets
    .map((t) => `- ${t.name}${t.context ? ` — ${t.context}` : ""}`)
    .join("\n")}`;
}

/** An already-active rule shown to the compiler for conflict/duplicate awareness. */
export type ExistingRule = { label: string; compiled: string };

/** Compile a user's wish into filing-model instructions. Pure Claude call, no DB. */
export async function compileInstructions(params: {
  scope: InstructionScope;
  userText: string;
  targets: CompileTarget[];
  existingRules?: ExistingRule[];
}): Promise<{ result: CompiledInstructions; model: string }> {
  const client = new Anthropic();
  const model = process.env.ANTHROPIC_MODEL || "claude-haiku-4-5";

  const existing = params.existingRules?.length
    ? `\n\nThe user's OTHER standing rules for this pipeline (already active — do NOT restate or duplicate them; flag conflicts in notes):\n${params.existingRules
        .map((r) => `- ${r.label || "(unnamed rule)"}:\n${r.compiled.replace(/^/gm, "  ")}`)
        .join("\n")}`
    : "";

  const response = await client.messages.parse({
    model,
    max_tokens: 1500,
    system: COMPILER_SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: `${scopeBlock(params.scope, params.targets)}${existing}\n\nThe user's wish, in their own words:\n\n"""${params.userText}"""`,
      },
    ],
    output_config: { format: zodOutputFormat(CompiledSchema) },
  });

  if (!response.parsed_output) {
    throw new Error("Instruction compilation returned no parseable output");
  }
  return { result: response.parsed_output, model };
}
