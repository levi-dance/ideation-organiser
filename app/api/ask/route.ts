import { NextResponse } from "next/server";
import { createSupabaseServerClient, createSupabaseAdminClient } from "@/lib/supabase/server";
import { embedTexts } from "@/lib/embeddings/voyage";
import { answerFromBrain } from "@/lib/claude/ask";
import { notionUrl } from "@/lib/notion/client";

export const maxDuration = 60;

const MATCH_COUNT = 10;

type MatchRow = {
  entry_id: string;
  entry_destination_id: string;
  content: string;
  similarity: number;
};

type HydratedFiledRow = {
  id: string;
  notion_page_id: string | null;
  created_at: string;
  destination: { title: string; category: { name: string; slug: string } | null } | null;
};

export async function POST(request: Request) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const question = typeof body?.question === "string" ? body.question.trim() : "";
  if (!question) {
    return NextResponse.json({ error: "question is required" }, { status: 400 });
  }
  if (question.length > 1000) {
    return NextResponse.json({ error: "question too long" }, { status: 400 });
  }

  try {
    const [queryEmbedding] = await embedTexts([question], "query");
    const db = createSupabaseAdminClient();
    const { data: matches, error } = await db.rpc("match_entries", {
      query_embedding: queryEmbedding,
      match_count: MATCH_COUNT,
    });
    if (error) throw new Error(`Search failed: ${error.message}`);
    const rows = (matches ?? []) as MatchRow[];

    if (!rows.length) {
      return NextResponse.json({
        answer:
          "Nothing filed in the second brain matches that yet — either it hasn't been captured, or embeddings haven't been backfilled.",
        sources: [],
      });
    }

    const { data: fds } = await db
      .from("entry_destinations")
      .select("id, notion_page_id, created_at, destination:destinations(title, category:categories(name, slug))")
      .in(
        "id",
        rows.map((r) => r.entry_destination_id)
      );
    const fdById = new Map(
      ((fds ?? []) as unknown as HydratedFiledRow[]).map((f) => [f.id, f])
    );

    const sources = rows.map((r, i) => {
      const fd = fdById.get(r.entry_destination_id);
      return {
        n: i + 1,
        entryId: r.entry_id,
        snippet: r.content,
        similarity: r.similarity,
        notionUrl: fd?.notion_page_id ? notionUrl(fd.notion_page_id) : null,
        destinationTitle: fd?.destination?.title ?? "",
        categoryName: fd?.destination?.category?.name ?? "",
        categorySlug: fd?.destination?.category?.slug ?? "",
        createdAt: fd?.created_at ?? "",
      };
    });

    const answer = await answerFromBrain({
      question,
      contexts: sources.map((s) => ({
        n: s.n,
        content: s.snippet,
        destinationTitle: s.destinationTitle,
        categoryName: s.categoryName,
        createdAt: s.createdAt,
      })),
    });

    return NextResponse.json({ answer, sources });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "ask failed" },
      { status: 500 }
    );
  }
}
