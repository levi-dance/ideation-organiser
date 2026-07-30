import Anthropic from "@anthropic-ai/sdk";

export type WeekItem = {
  categoryName: string;
  destinationTitle: string;
  title: string;
  body: string;
  createdAt: string;
};

function systemPrompt(): string {
  // Optional free-text description of the user (clients, channels, projects)
  // so next actions can be organised around their real world.
  const context = process.env.SYNTHESIS_CONTEXT?.trim();
  return `You write the weekly synthesis for the user's personal "second brain" — a review of the thoughts they captured this week.${
    context ? `\n\nAbout the user: ${context}` : ""
  }

Produce lightweight Markdown only: ## headings, - bullets, **bold**. Never tables, images, code fences, or nested lists.

Structure:
## Themes noticed
2-4 bullets on what kept coming up across the week's entries.

## Connections
Bullets calling out non-obvious links BETWEEN entries — two captures that belong together, an idea that answers an earlier one.

## Suggested next actions
One bullet per client, channel, or project THAT HAD ACTIVITY this week — omit silent ones entirely rather than inventing actions. Include other areas only when the week's entries clearly suggest a next step.

Ground every observation in the actual entries. Be specific and brief; never pad.`;
}

/** One Claude call turning the week's filed items into a markdown synthesis. */
export async function synthesizeWeek(items: WeekItem[]): Promise<string> {
  const client = new Anthropic();
  const model = process.env.ANTHROPIC_MODEL || "claude-haiku-4-5";

  const grouped = new Map<string, WeekItem[]>();
  for (const item of items) {
    const list = grouped.get(item.categoryName) ?? [];
    list.push(item);
    grouped.set(item.categoryName, list);
  }
  const digest = [...grouped]
    .map(
      ([category, list]) =>
        `### ${category}\n` +
        list
          .map((i) => {
            const day = new Date(i.createdAt).toLocaleDateString(undefined, {
              timeZone: process.env.APP_TIMEZONE || "UTC",
              weekday: "short",
            });
            return `- [${day}] ${i.destinationTitle}: ${i.title}${i.body ? ` — ${i.body}` : ""}`;
          })
          .join("\n")
    )
    .join("\n\n");

  const response = await client.messages.create({
    model,
    max_tokens: 2048,
    system: systemPrompt(),
    messages: [
      {
        role: "user",
        content: `This week's filed entries, grouped by category:\n\n${digest}`,
      },
    ],
  });

  const text = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();
  if (!text) throw new Error("Synthesis returned no text");
  return text;
}
