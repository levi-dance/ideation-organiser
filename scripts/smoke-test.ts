/**
 * End-to-end smoke test of the classify → Notion → entry-log pipeline,
 * using the real classify/write modules against live services.
 * Run: npx tsx --env-file=.env.local scripts/smoke-test.ts "your thought here"
 */
import { createClient } from "@supabase/supabase-js";
import { classifyEntry, PROMPT_VERSION } from "../lib/claude/classify";
import { writeToDestination } from "../lib/notion/write";
import { notionUrl } from "../lib/notion/client";
import type { DestinationWithCategory } from "../lib/types";

const transcript =
  process.argv[2] ?? "add milk, eggs and a loaf of sourdough to the grocery list";

async function main() {
  const db = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );

  const { data: entry } = await db
    .from("entries")
    .insert({ source: "text", raw_transcript: transcript, status: "classifying" })
    .select()
    .single();
  if (!entry) throw new Error("entry insert failed");
  console.log("entry recorded:", entry.id);

  const { data: rows } = await db
    .from("destinations")
    .select("*, category:categories(*)")
    .eq("is_active", true);
  const destinations = rows as unknown as DestinationWithCategory[];
  console.log("taxonomy loaded:", destinations.length, "destinations");

  const catchAll = destinations.find((d) => d.category.slug === "general-notes") ?? null;
  const result = await classifyEntry({
    transcript,
    destinations,
    catchAllDestinationId: catchAll?.id ?? null,
  });
  console.log(
    `classified in ${result.latencyMs}ms (${result.usage.input_tokens} in / ${result.usage.output_tokens} out, cache read: ${result.usage.cache_read_input_tokens})`
  );

  await db.from("classification_runs").insert({
    entry_id: entry.id,
    model: result.model,
    prompt_version: PROMPT_VERSION,
    raw_response: result.raw,
    latency_ms: result.latencyMs,
    input_tokens: result.usage.input_tokens,
    output_tokens: result.usage.output_tokens,
    cache_read_tokens: result.usage.cache_read_input_tokens,
  });

  for (const target of result.classification.destinations) {
    const dest = destinations.find((d) => d.id === target.destination_id);
    if (!dest) {
      console.log("  ✗ unknown destination id", target.destination_id);
      continue;
    }
    const write = await writeToDestination(
      dest,
      target.formatted_title,
      target.formatted_body,
      `http://localhost:3000/entries/${entry.id}`,
      target.development_prompts?.slice(0, 3) ?? []
    );
    await db.from("entry_destinations").insert({
      entry_id: entry.id,
      destination_id: dest.id,
      action_type: dest.kind === "bank_database" ? "append_row" : "append_block",
      notion_page_id: write.notionPageId,
      notion_block_ids: write.notionBlockIds,
      content_snippet: target.formatted_title,
      warning: write.warning,
    });
    console.log(
      `  ✓ ${dest.category.name} → ${dest.title}: "${target.formatted_title}" ${
        write.notionPageId ? notionUrl(write.notionPageId) : ""
      }`
    );
    if (target.formatted_body) {
      console.log(`    body: ${JSON.stringify(target.formatted_body)}`);
    }
    for (const prompt of target.development_prompts ?? []) {
      console.log(`    dev prompt: (${prompt})`);
    }
  }

  await db.from("entries").update({ status: "filed" }).eq("id", entry.id);
  console.log("done - entry status: filed");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
