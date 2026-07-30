import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { undoDestination } from "@/lib/pipeline/undo";

export const maxDuration = 60;

export async function POST(request: Request) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => null);
  const entryDestinationId = body?.entryDestinationId;
  if (typeof entryDestinationId !== "string") {
    return NextResponse.json({ error: "entryDestinationId is required" }, { status: 400 });
  }

  try {
    await undoDestination(entryDestinationId, "undone by user");
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "undo failed" },
      { status: 500 }
    );
  }
}
