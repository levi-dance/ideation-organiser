import { NextResponse } from "next/server";
import { createSupabaseAdminClient, createSupabaseServerClient } from "@/lib/supabase/server";
import { HUES, ICON_POOL } from "@/lib/design/category-style";

const MAX_LENGTH = 2000;

/**
 * Update one category's routing description and its appearance.
 *
 * Not the name, deliberately. A category's name mirrors its Notion page title
 * and the next sync overwrites it, so editing the name here would look like it
 * worked and then silently revert. Description, icon, and hue live only in
 * Postgres, which is why they need an editor at all.
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

  // Appearance is optional on this call; an explicit null clears the override
  // and hands the category back to the keyword guess.
  const updates: Record<string, unknown> = { description };
  if ("icon" in (body ?? {})) {
    const icon = body.icon;
    if (icon !== null && !(typeof icon === "string" && icon in ICON_POOL)) {
      return NextResponse.json({ error: `"${icon}" is not one of the icons.` }, { status: 400 });
    }
    updates.icon = icon;
  }
  if ("hue" in (body ?? {})) {
    const hue = body.hue;
    if (hue !== null && !(typeof hue === "string" && (HUES as string[]).includes(hue))) {
      return NextResponse.json({ error: `"${hue}" is not one of the colours.` }, { status: 400 });
    }
    updates.hue = hue;
  }

  const db = createSupabaseAdminClient();
  const { data, error } = await db
    .from("categories")
    .update(updates)
    .eq("id", id)
    .select("id, description, icon, hue")
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: "That category no longer exists." }, { status: 404 });
  }
  return NextResponse.json(data);
}
