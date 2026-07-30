import { NextResponse } from "next/server";
import { createSupabaseAdminClient, createSupabaseServerClient } from "@/lib/supabase/server";
import {
  compileInstructions,
  type CompileTarget,
  type InstructionScope,
} from "@/lib/claude/compile-instructions";
import { workLists } from "@/lib/clickup/lists";

export const maxDuration = 60;

const SCOPES: InstructionScope[] = ["personal", "work", "synthesis"];

async function targetsFor(scope: InstructionScope): Promise<CompileTarget[]> {
  if (scope === "personal") {
    const db = createSupabaseAdminClient();
    const { data } = await db
      .from("destinations")
      .select("title, category:categories(name)")
      .eq("is_active", true)
      .order("title");
    return (data ?? []).map((d) => ({
      name: d.title as string,
      context: (d.category as unknown as { name: string } | null)?.name ?? "",
    }));
  }
  if (scope === "work") {
    return workLists().map((l) => ({ name: l.name, context: l.description }));
  }
  return [];
}

/**
 * Compile-and-save the owner's wish for one pipeline. Empty text clears the
 * instruction. The user's words and the compiled block are both stored, so
 * they can re-edit from their own phrasing later.
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
  const scope = SCOPES.includes(body?.scope) ? (body.scope as InstructionScope) : null;
  const text = typeof body?.text === "string" ? body.text.trim() : "";
  if (!scope) {
    return NextResponse.json({ error: "scope must be personal, work, or synthesis" }, { status: 400 });
  }
  if (text.length > 4000) {
    return NextResponse.json({ error: "instructions too long (4000 chars max)" }, { status: 400 });
  }

  const db = createSupabaseAdminClient();
  try {
    if (!text) {
      const { error } = await db
        .from("ai_instructions")
        .update({ is_active: false, updated_at: new Date().toISOString() })
        .eq("scope", scope);
      if (error) throw new Error(error.message);
      return NextResponse.json({ cleared: true });
    }

    const targets = await targetsFor(scope);
    if (scope === "work" && !targets.length) {
      return NextResponse.json(
        { error: "No ClickUp lists configured — set CLICKUP_LISTS first." },
        { status: 400 }
      );
    }

    const { result, model } = await compileInstructions({ scope, userText: text, targets });
    if (!result.compiled.trim()) {
      // Nothing actionable — don't overwrite an existing working instruction.
      return NextResponse.json({ compiled: "", notes: result.notes });
    }

    const { error } = await db.from("ai_instructions").upsert(
      {
        scope,
        user_text: text,
        compiled_text: result.compiled,
        is_active: true,
        model,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "scope" }
    );
    if (error) throw new Error(error.message);

    return NextResponse.json({ compiled: result.compiled, notes: result.notes });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "compile failed" },
      { status: 500 }
    );
  }
}
