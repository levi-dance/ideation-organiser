import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { needsFirstRunSetup } from "@/lib/auth/setup";

/**
 * Create the app's one account, and only while no account exists. This is the
 * unauthenticated route in the app, so the zero-users check is the entire
 * guard: once it returns false this endpoint can never create anything again.
 */
export async function POST(request: Request) {
  if (!(await needsFirstRunSetup())) {
    return NextResponse.json(
      { error: "This app already has an account. Sign in instead." },
      { status: 409 }
    );
  }

  const body = await request.json().catch(() => null);
  const email = typeof body?.email === "string" ? body.email.trim() : "";
  const password = typeof body?.password === "string" ? body.password : "";
  if (!email || !email.includes("@")) {
    return NextResponse.json({ error: "A valid email is required." }, { status: 400 });
  }
  if (password.length < 8) {
    return NextResponse.json(
      { error: "Password must be at least 8 characters." },
      { status: 400 }
    );
  }

  try {
    const admin = createSupabaseAdminClient();
    // email_confirm skips the verification mail: there is no one else to let in,
    // and requiring it would need SMTP configured before first login.
    const { error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (error) throw new Error(error.message);
    return NextResponse.json({ created: true });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Could not create the account" },
      { status: 500 }
    );
  }
}
