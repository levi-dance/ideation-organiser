/**
 * One-time (re-runnable) backfill: embed every non-undone filed item that has
 * no embedding yet. Idempotent - the unique entry_destination_id + upsert make
 * repeat runs safe.
 * Run: npm run backfill:embeddings
 */
import { createClient } from "@supabase/supabase-js";
import { embedFiledItems, type EmbedItem } from "../lib/pipeline/embed";
import { splitSnippet } from "../lib/pipeline/snippet";

const BATCH_SIZE = 100;

async function main() {
  const db = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );

  // Page through both tables - supabase-js caps un-ranged selects at 1000 rows.
  const PAGE = 1000;
  async function fetchAll<T>(
    query: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
    label: string
  ): Promise<T[]> {
    const all: T[] = [];
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await query(from, from + PAGE - 1);
      if (error) throw new Error(`Could not read ${label}: ${error.message}`);
      all.push(...(data ?? []));
      if (!data || data.length < PAGE) return all;
    }
  }

  const embedded = await fetchAll(
    (from, to) => db.from("entry_embeddings").select("entry_destination_id").range(from, to),
    "entry_embeddings"
  );
  const done = new Set(embedded.map((r) => r.entry_destination_id as string));

  const filedRows = await fetchAll(
    (from, to) =>
      db
        .from("entry_destinations")
        .select("id, entry_id, content_snippet")
        .is("undone_at", null)
        .order("created_at")
        .range(from, to),
    "entry_destinations"
  );

  const pending: EmbedItem[] = (filedRows ?? [])
    .filter((r) => !done.has(r.id as string))
    .map((r) => {
      // Same recovery heuristic reassign uses: split the stored snippet.
      const { title, body } = splitSnippet(r.content_snippet as string);
      return {
        entryId: r.entry_id as string,
        entryDestinationId: r.id as string,
        title,
        body,
      };
    });

  if (!pending.length) {
    console.log(`Nothing to backfill - ${done.size} item(s) already embedded.`);
    return;
  }

  console.log(`Embedding ${pending.length} filed item(s) in batches of ${BATCH_SIZE}...`);
  for (let i = 0; i < pending.length; i += BATCH_SIZE) {
    await embedFiledItems(db, pending.slice(i, i + BATCH_SIZE));
    console.log(`  ${Math.min(i + BATCH_SIZE, pending.length)}/${pending.length}`);
  }
  console.log("Backfill complete.");
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
