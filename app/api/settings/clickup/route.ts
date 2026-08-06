import { NextResponse } from "next/server";
import { createSupabaseAdminClient, createSupabaseServerClient } from "@/lib/supabase/server";
import { assignKeys } from "@/lib/clickup/lists";

/** A list the user has ticked, as the Settings panel sends it. */
type IncomingList = { listId: string; name: string; description: string };

/**
 * Replace the configured set of work lists in one save. Ticking, unticking,
 * renaming, and re-describing all arrive together, so the whole set is written
 * atomically rather than diffed field by field.
 *
 * Unticked lists are deactivated, never deleted: the row keeps the list out of
 * the env-var fallback, and clickup_actions history still reads sensibly.
 */
export async function PUT(request: Request) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const raw = Array.isArray(body?.lists) ? (body.lists as unknown[]) : null;
  if (!raw) {
    return NextResponse.json({ error: "lists must be an array" }, { status: 400 });
  }

  const lists: IncomingList[] = [];
  for (const item of raw) {
    const l = item as Partial<IncomingList>;
    const listId = typeof l.listId === "string" ? l.listId.trim() : "";
    const name = typeof l.name === "string" ? l.name.trim() : "";
    const description = typeof l.description === "string" ? l.description.trim() : "";
    if (!listId || !name) {
      return NextResponse.json({ error: "Every list needs a listId and a name." }, { status: 400 });
    }
    // The description is the only thing the classifier reads to pick a list, so
    // a blank one silently degrades routing. Refuse rather than accept it.
    if (!description) {
      return NextResponse.json(
        { error: `"${name}" needs a description - it is what the AI reads to route work there.` },
        { status: 400 }
      );
    }
    if (description.length > 1000) {
      return NextResponse.json(
        { error: `"${name}" description is too long (1000 chars max).` },
        { status: 400 }
      );
    }
    if (lists.some((existing) => existing.listId === listId)) {
      return NextResponse.json({ error: `"${name}" is listed twice.` }, { status: 400 });
    }
    lists.push({ listId, name, description });
  }

  const db = createSupabaseAdminClient();
  try {
    // Deactivate everything first, then reactivate what was sent. A list
    // dropped from the set is left behind as an inactive row.
    const { error: clearError } = await db
      .from("work_lists")
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq("is_active", true);
    if (clearError) throw new Error(clearError.message);

    if (lists.length) {
      const rows = assignKeys(lists).map((l, i) => ({
        list_id: l.listId,
        key: l.key,
        name: l.name,
        description: l.description,
        is_active: true,
        sort_order: i,
        updated_at: new Date().toISOString(),
      }));
      const { error } = await db.from("work_lists").upsert(rows, { onConflict: "list_id" });
      if (error) throw new Error(error.message);
    }
    return NextResponse.json({ saved: lists.length });
  } catch (e) {
    const message = e instanceof Error ? e.message : "save failed";
    // The most likely cause on an older database is the table not existing.
    if (/work_lists/.test(message) && /(does not exist|schema cache)/.test(message)) {
      return NextResponse.json(
        { error: "The work_lists table doesn't exist yet. Run supabase/schema.sql in the Supabase SQL Editor, then try again." },
        { status: 500 }
      );
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
