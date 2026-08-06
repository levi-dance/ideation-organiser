import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { proposeTaxonomy } from "@/lib/claude/propose-taxonomy";

export const maxDuration = 60;

const MIN_LENGTH = 40;
const MAX_LENGTH = 8000;

/**
 * Draft a filing structure from the user's description of their life and work.
 * Creates nothing: the proposal is edited in the UI and confirmed separately.
 */
export async function POST(request: Request) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const about = typeof body?.about === "string" ? body.about.trim() : "";
  const feedback = typeof body?.feedback === "string" ? body.feedback.trim() : "";

  if (about.length < MIN_LENGTH) {
    return NextResponse.json(
      {
        error:
          "Write a bit more first. A few sentences about your work, your projects, and what you tend to capture is enough.",
      },
      { status: 400 }
    );
  }
  if (about.length > MAX_LENGTH) {
    return NextResponse.json(
      { error: `That is longer than ${MAX_LENGTH} characters. Trim it to the essentials.` },
      { status: 400 }
    );
  }

  try {
    const { proposal } = await proposeTaxonomy({ about, feedback: feedback || null });
    return NextResponse.json(proposal);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Could not draft a structure" },
      { status: 500 }
    );
  }
}
