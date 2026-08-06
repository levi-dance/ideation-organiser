import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { notion, notionUrl } from "@/lib/notion/client";
import { createContainerPage } from "@/lib/notion/write";
import { chunkBlocks, markdownToBlocks } from "@/lib/notion/markdown";
import { synthesizeWeek, type WeekItem } from "@/lib/claude/synthesize";
import { withRetry } from "@/lib/pipeline/ingest";
import { activeInstructions } from "@/lib/pipeline/instructions";
import { splitSnippet } from "@/lib/pipeline/snippet";
import { appTimezone } from "@/lib/settings/app-settings";

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
 * it on first run. Found by title each run on purpose - a destinations row
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

/** The day of the week it currently is where the owner lives. */
function localWeekday(timezone: string, date = new Date()): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: timezone, weekday: "long" }).format(date);
}

/**
 * Whether this week's page is already in the container. Vercel can retry a
 * cron invocation, and the run is not otherwise idempotent: without this a
 * retry would write a second page for the same week.
 */
async function weekAlreadyWritten(containerId: string, weekTitle: string): Promise<boolean> {
  const wanted = weekTitle.trim().toLowerCase();
  let cursor: string | undefined;
  do {
    const res = await notion().blocks.children.list({
      block_id: containerId,
      page_size: 100,
      start_cursor: cursor,
    });
    for (const block of res.results) {
      if (!("type" in block) || block.type !== "child_page") continue;
      const child = block as unknown as { child_page: { title: string } };
      if (child.child_page.title.trim().toLowerCase() === wanted) return true;
    }
    cursor = res.has_more ? (res.next_cursor ?? undefined) : undefined;
  } while (cursor);
  return false;
}

/**
 * Vercel Cron target. The schedule in vercel.json fires this once a day at a
 * fixed UTC hour, and the run decides for itself whether today is Monday where
 * the owner actually lives, using the timezone saved in Settings.
 *
 * Doing it this way rather than encoding the hour in the cron expression is
 * what keeps one person's timezone out of a repo other people deploy: Vercel
 * cron expressions are UTC only and static in the file, so any single schedule
 * would be somebody's Monday morning and somebody else's Sunday afternoon.
 *
 * Pass ?force=1 to run it on any day, for testing.
 */
export async function GET(request: Request) {
  const auth = request.headers.get("authorization");
  if (process.env.CRON_SECRET && auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = createSupabaseAdminClient();
  const timezone = await appTimezone(db);
  const force = new URL(request.url).searchParams.get("force") === "1";
  if (!force && localWeekday(timezone) !== "Monday") {
    return NextResponse.json({
      skipped: true,
      reason: `it is ${localWeekday(timezone)} in ${timezone}, not Monday`,
    });
  }

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
    const { title, body } = splitSnippet(r.content_snippet);
    return {
      categoryName: r.destination?.category?.name ?? "Uncategorised",
      destinationTitle: r.destination?.title ?? "",
      title,
      body,
      createdAt: r.created_at,
    };
  });

  if (!items.length) {
    return NextResponse.json({ skipped: true, reason: "no entries this week" });
  }

  try {
    const rootId = process.env.NOTION_ROOT_PAGE_ID;
    if (!rootId) throw new Error("NOTION_ROOT_PAGE_ID is not set");
    const containerId = await findOrCreateContainer(rootId);

    const weekTitle = `Week of ${new Date().toLocaleDateString(undefined, {
      timeZone: timezone,
      day: "numeric",
      month: "short",
      year: "numeric",
    })}`;
    // Checked before the Claude call so a retry costs nothing.
    if (!force && (await weekAlreadyWritten(containerId, weekTitle))) {
      return NextResponse.json({ skipped: true, reason: `${weekTitle} already exists` });
    }

    const customContext = await activeInstructions(db, "synthesis");
    const markdown = await withRetry(() => synthesizeWeek(items, customContext, timezone));

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
