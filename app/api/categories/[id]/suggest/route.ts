import { NextResponse } from "next/server";
import { createSupabaseAdminClient, createSupabaseServerClient } from "@/lib/supabase/server";
import { describeCategoryFromFilings } from "@/lib/claude/describe";
import { splitSnippet } from "@/lib/pipeline/snippet";

export const maxDuration = 60;

/** How many filed items are enough to show what a category is really for. */
const SAMPLE_SIZE = 30;

/**
 * Draft a sharper description for one category from what has actually been
 * filed into it, as a starting point the user edits. Read-only.
 */
export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await context.params;
  const db = createSupabaseAdminClient();

  const { data: category, error } = await db
    .from("categories")
    .select("id, name, description")
    .eq("id", id)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!category) {
    return NextResponse.json({ error: "That category no longer exists." }, { status: 404 });
  }

  try {
    const { data: destinations } = await db
      .from("destinations")
      .select("id, title")
      .eq("category_id", id)
      .eq("is_active", true);
    const destinationIds = (destinations ?? []).map((d) => d.id as string);

    // Siblings give the model the neighbours it needs in order to write a
    // description that discriminates rather than one that merely describes.
    const { data: siblings } = await db
      .from("categories")
      .select("name")
      .eq("is_active", true)
      .neq("id", id);

    let filedTitles: string[] = [];
    if (destinationIds.length) {
      const { data: filed } = await db
        .from("entry_destinations")
        .select("content_snippet")
        .in("destination_id", destinationIds)
        .is("undone_at", null)
        .order("created_at", { ascending: false })
        .limit(SAMPLE_SIZE);
      filedTitles = (filed ?? []).map((f) => splitSnippet(f.content_snippet as string).title);
    }

    const description = await describeCategoryFromFilings({
      name: category.name as string,
      siblingNames: (siblings ?? []).map((s) => s.name as string),
      destinationTitles: (destinations ?? []).map((d) => d.title as string),
      filedTitles,
      currentDescription: (category.description as string) ?? "",
    });
    return NextResponse.json({ description, sampledItems: filedTitles.length });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Could not draft a description" },
      { status: 500 }
    );
  }
}
