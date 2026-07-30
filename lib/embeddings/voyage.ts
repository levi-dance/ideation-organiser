/**
 * Voyage AI embeddings client - plain fetch, one endpoint, no SDK needed.
 * https://docs.voyageai.com/reference/embeddings-api
 */

const VOYAGE_URL = "https://api.voyageai.com/v1/embeddings";

export const EMBEDDING_MODEL = process.env.VOYAGE_MODEL || "voyage-3.5-lite";

/** Must match the vector(N) column in entry_embeddings - changing it means re-backfilling. */
export const EMBEDDING_DIM = 1024;

export async function embedTexts(
  texts: string[],
  inputType: "document" | "query"
): Promise<number[][]> {
  if (!texts.length) return [];
  const key = process.env.VOYAGE_API_KEY;
  if (!key) throw new Error("VOYAGE_API_KEY is not set");

  const res = await fetch(VOYAGE_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      input: texts,
      model: EMBEDDING_MODEL,
      input_type: inputType,
      output_dimension: EMBEDDING_DIM,
    }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    const error = new Error(`Voyage embeddings failed (${res.status}): ${detail.slice(0, 300)}`);
    (error as Error & { status: number }).status = res.status;
    throw error;
  }
  const json = (await res.json()) as { data: { embedding: number[]; index: number }[] };
  return json.data.sort((a, b) => a.index - b.index).map((d) => d.embedding);
}
