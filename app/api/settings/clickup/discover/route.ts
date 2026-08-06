import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { clickupTokenConfigured } from "@/lib/clickup/client";
import { discoverLists } from "@/lib/clickup/discover";

export const maxDuration = 60;

/** Read-only: every list this ClickUp token can see, for the Settings picker. */
export async function GET() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!clickupTokenConfigured()) {
    return NextResponse.json(
      { error: "CLICKUP_API_TOKEN is not set. Add it to your environment and redeploy." },
      { status: 400 }
    );
  }

  try {
    return NextResponse.json({ lists: await discoverLists() });
  } catch (e) {
    const message = e instanceof Error ? e.message : "discovery failed";
    if (/401|Unauthorized|OAUTH/i.test(message)) {
      return NextResponse.json(
        { error: "ClickUp rejected the token. Check CLICKUP_API_TOKEN in ClickUp Settings, Apps, API Token." },
        { status: 400 }
      );
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
