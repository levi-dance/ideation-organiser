import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { clickupTokenConfigured, getListTasks } from "@/lib/clickup/client";
import { describeWorkList } from "@/lib/claude/describe";

export const maxDuration = 60;

/** How many task names are enough to infer what a list is for. */
const SAMPLE_SIZE = 25;

/**
 * Draft a routing description for one list from the work already in it, as a
 * starting point the user edits. Read-only against ClickUp.
 */
export async function POST(request: Request) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!clickupTokenConfigured()) {
    return NextResponse.json({ error: "CLICKUP_API_TOKEN is not set." }, { status: 400 });
  }

  const body = await request.json().catch(() => null);
  const listId = typeof body?.listId === "string" ? body.listId.trim() : "";
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  const path = typeof body?.path === "string" ? body.path.trim() : "";
  if (!listId || !name) {
    return NextResponse.json({ error: "listId and name are required" }, { status: 400 });
  }

  try {
    const tasks = await getListTasks(listId);
    const description = await describeWorkList({
      name,
      path: path || name,
      taskNames: tasks.slice(0, SAMPLE_SIZE).map((t) => t.name),
    });
    return NextResponse.json({ description, sampledTasks: Math.min(tasks.length, SAMPLE_SIZE) });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Could not draft a description" },
      { status: 500 }
    );
  }
}
