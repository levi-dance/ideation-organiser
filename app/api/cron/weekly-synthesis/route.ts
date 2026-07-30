import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { notion, notionUrl } from "@/lib/notion/client";
import { createContainerPage } from "@/lib/notion/write";
import { chunkBlocks, markdownToBlocks } from "@/lib/notion/markdown";
import { synthesizeWeek, type WeekItem } from "@/lib/claude/synthesize";
import { withRetry } from "@/lib/pipeline/ingest";

export const maxDuration = 60;

const CONTAINER_TITLE = "Weekly Synthesis";

type AppendChildren = Parameters<
  ReturnType<typeof notion>["blocks"]["children"]["append"]
>[0]["children"];

type FiledRow = {
  content_snippet: string;
  created_at: string;
  destination: { title: string; category: { name: string } | null } | null;
};

/**
 * Find the "Weekly Synthesis" container directly under the root page, creating
 * it on first run. Found by title each run on purpose — a destinations row
 * would surface it to the classifier as a filing target.
 */
async function findOrCreateContainer(rootId: string): Promise<string> {
  const normalize = (id: string) => id.replace(/-/g, "");
  const root = normalize(rootId);
  let cursor: string | undefined;
  do {
    const res = await notion().search({
      query: CONTAINER_TITLE,
      page_size: 100,
      start_cursor: cursor,
    });
    for (const item of res.results) {
      if (item.object !== "page" || !("properties" in item) || item.in_trash) continue;
      if (item.parent.type !== "page_id" || normalize(item.parent.page_id) !== root) continue;
      const titleProp = Object.values(item.properties).find((p) => p.type === "title");
      const title =
        titleProp?.type === "title"
          ? titleProp.title.map((t) => t.plain_text).join("").trim()
          : "";
      if (title.toLowerCase() === CONTAINER_TITLE.toLowerCase()) return item.id;
    }
    cursor = res.has_more ? (res.next_cursor ?? undefined) : undefined;
  } while (cursor);
  return createContainerPage(rootId, CONTAINER_TITLE);
}

/**
 * Vercel Cron target (schedule in vercel.json is UTC — adjust it to land on
 * your local Monday morning). Reads the last 7 days of filed items and writes
 * a "Week of …" synthesis page into Notion.
 */
export async function GET(request: Request) {
  const auth = request.headers.get("authorization");
  if (process.env.CRON_SECRET && auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = createSupabaseAdminClient();
  const since = new Date(Date.now() - 7 * 24 * 3_600_000).toISOString();
  const { data: rows, error } = await db
    .from("entry_destinations")
    .select("content_snippet, created_at, destination:destinations(title, category:categories(name))")
    .gte("created_at", since)
    .is("undone_at", null)
    .order("created_at");
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const items: WeekItem[] = ((rows ?? []) as unknown as FiledRow[]).map((r) => {
    const sep = r.content_snippet.indexOf(" — ");
    return {
      categoryName: r.destination?.category?.name ?? "Uncategorised",
      destinationTitle: r.destination?.title ?? "",
      title: sep === -1 ? r.content_snippet : r.content_snippet.slice(0, sep),
      body: sep === -1 ? "" : r.content_snippet.slice(sep + 3),
      createdAt: r.created_at,
    };
  });

  if (!items.length) {
    return NextResponse.json({ skipped: true, reason: "no entries this week" });
  }

  try {
    const markdown = await withRetry(() => synthesizeWeek(items));

    const rootId = process.env.NOTION_ROOT_PAGE_ID;
    if (!rootId) throw new Error("NOTION_ROOT_PAGE_ID is not set");
    const containerId = await findOrCreateContainer(rootId);

    const weekTitle = `Week of ${new Date().toLocaleDateString(undefined, {
      timeZone: process.env.APP_TIMEZONE || "UTC",
      day: "numeric",
      month: "short",
      year: "numeric",
    })}`;
    const page = await notion().pages.create({
      parent: { page_id: containerId },
      properties: { title: { title: [{ text: { content: weekTitle } }] } },
    });
    for (const chunk of chunkBlocks(markdownToBlocks(markdown))) {
      await notion().blocks.children.append({
        block_id: page.id,
        children: chunk as unknown as AppendChildren,
      });
    }

    return NextResponse.json({ pageUrl: notionUrl(page.id), items: items.length });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "synthesis failed" },
      { status: 500 }
    );
  }
}
