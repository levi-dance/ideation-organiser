import { NextResponse } from "next/server";
import { createSupabaseAdminClient, createSupabaseServerClient } from "@/lib/supabase/server";

const MAX_LENGTH = 2000;

/**
 * Update one category's routing description.
 *
 * Description only, deliberately. A category's name mirrors its Notion page
 * title and the next sync overwrites it, so editing the name here would look
 * like it worked and then silently revert. Descriptions live only in Postgres,
 * which is why they need an editor at all: there is nowhere else to change them.
 */
export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await context.params;
  const body = await request.json().catch(() => null);
  const description = typeof body?.description === "string" ? body.description.trim() : "";

  // An empty description leaves the classifier with only a name to go on, which
  // silently degrades every future capture. Refuse rather than accept it.
  if (!description) {
    return NextResponse.json(
      { error: "A description is required: it is what the AI reads to decide what belongs here." },
      { status: 400 }
    );
  }
  if (description.length > MAX_LENGTH) {
    return NextResponse.json(
      { error: `That is too long (${MAX_LENGTH} characters max).` },
      { status: 400 }
    );
  }

  const db = createSupabaseAdminClient();
  const { data, error } = await db
    .from("categories")
    .update({ description })
    .eq("id", id)
    .select("id, description")
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: "That category no longer exists." }, { status: 404 });
  }
  return NextResponse.json(data);
}
