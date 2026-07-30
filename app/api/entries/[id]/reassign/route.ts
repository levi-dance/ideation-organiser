import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { reassignDestination } from "@/lib/pipeline/undo";

export const maxDuration = 60;

export async function POST(request: Request) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => null);
  const entryDestinationId = body?.entryDestinationId;
  const toDestinationId = body?.toDestinationId;
  if (typeof entryDestinationId !== "string" || typeof toDestinationId !== "string") {
    return NextResponse.json(
      { error: "entryDestinationId and toDestinationId are required" },
      { status: 400 }
    );
  }

  try {
    const result = await reassignDestination(entryDestinationId, toDestinationId);
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "reassign failed" },
      { status: 500 }
    );
  }
}
