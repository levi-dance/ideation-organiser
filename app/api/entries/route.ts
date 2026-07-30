import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { ingest } from "@/lib/pipeline/ingest";
import { ingestWork } from "@/lib/pipeline/ingest-work";

export const maxDuration = 60;

export async function POST(request: Request) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const transcript = typeof body?.transcript === "string" ? body.transcript.trim() : "";
  const source = body?.source === "voice" ? "voice" : "text";
  const edited = Boolean(body?.edited);
  // Scope is the owner's manual call, never inferred — Work → ClickUp, Personal → Notion.
  const scope = body?.scope === "work" ? "work" : "personal";

  if (!transcript) {
    return NextResponse.json({ error: "transcript is required" }, { status: 400 });
  }
  if (transcript.length > 10_000) {
    return NextResponse.json({ error: "transcript too long" }, { status: 400 });
  }

  try {
    const result =
      scope === "work"
        ? await ingestWork({ transcript, source, edited })
        : await ingest({ transcript, source, edited });
    return NextResponse.json({ ...result, scope });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "ingest failed" },
      { status: 500 }
    );
  }
}
