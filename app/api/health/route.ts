import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { runHealthChecks } from "@/lib/setup/health";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Probe every dependency and report the exact remedy for each failure.
 * Session-guarded: the results name which of the owner's services are broken.
 */
export async function GET() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return NextResponse.json(await runHealthChecks());
}
