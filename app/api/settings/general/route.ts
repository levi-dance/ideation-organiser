import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isValidTimezone, saveTimezone } from "@/lib/settings/app-settings";

/** Save the non-secret app settings. Currently just the timezone. */
export async function PUT(request: Request) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const timezone = typeof body?.timezone === "string" ? body.timezone.trim() : "";
  if (!timezone) {
    return NextResponse.json({ error: "A timezone is required." }, { status: 400 });
  }
  if (!isValidTimezone(timezone)) {
    return NextResponse.json(
      {
        error: `"${timezone}" is not a timezone name. It should look like Australia/Sydney or America/New_York.`,
      },
      { status: 400 }
    );
  }

  try {
    await saveTimezone(timezone);
    return NextResponse.json({ timezone });
  } catch (e) {
    const message = e instanceof Error ? e.message : "save failed";
    if (/app_settings/.test(message) && /(does not exist|schema cache)/.test(message)) {
      return NextResponse.json(
        {
          error:
            "The app_settings table doesn't exist yet. Run supabase/schema.sql in the Supabase SQL Editor, then try again.",
        },
        { status: 500 }
      );
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
