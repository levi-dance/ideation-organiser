import Anthropic from "@anthropic-ai/sdk";

export type AskContext = {
  n: number;
  content: string;
  destinationTitle: string;
  categoryName: string;
  createdAt: string;
};

const SYSTEM_PROMPT = `You answer questions from the user's personal "second brain" — a log of their own captured thoughts, provided as numbered excerpts.

Rules:
- Answer ONLY from the excerpts. Never invent, pad, or draw on outside knowledge.
- Cite every claim with [n] markers matching the excerpts it came from.
- Be direct and brief — a few sentences, or a short list if the question asks for several things.
- If the excerpts don't contain an answer, say so plainly.`;

/**
 * Generate a cited answer from retrieved second-brain excerpts. No graceful
 * fallback on purpose — a fabricated answer is worse than an error.
 */
export async function answerFromBrain(params: {
  question: string;
  contexts: AskContext[];
}): Promise<string> {
  const client = new Anthropic();
  const model = process.env.ANTHROPIC_MODEL || "claude-haiku-4-5";

  const contextBlock = params.contexts
    .map(
      (c) =>
        `[${c.n}] (${c.categoryName} → ${c.destinationTitle}, ${
          c.createdAt ? new Date(c.createdAt).toLocaleDateString() : "undated"
        })\n${c.content}`
    )
    .join("\n\n");

  const response = await client.messages.create({
    model,
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: `Excerpts from the second brain:\n\n${contextBlock}\n\nQuestion: ${params.question}`,
      },
    ],
  });

  const text = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();
  if (!text) throw new Error("Answer generation returned no text");
  return text;
}
