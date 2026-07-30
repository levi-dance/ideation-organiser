import { NextResponse } from "next/server";
import { createSupabaseAdminClient, createSupabaseServerClient } from "@/lib/supabase/server";
import { compileInstructions, type InstructionScope } from "@/lib/claude/compile-instructions";
import {
  INSTRUCTION_SCOPES,
  existingRulesFor,
  targetsFor,
} from "@/lib/pipeline/instructions";

export const maxDuration = 60;

/** Add one instruction: compile the wish (conflict-aware) and insert a new row. */
export async function POST(request: Request) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const scope = INSTRUCTION_SCOPES.includes(body?.scope)
    ? (body.scope as InstructionScope)
    : null;
  const text = typeof body?.text === "string" ? body.text.trim() : "";
  if (!scope) {
    return NextResponse.json({ error: "scope must be personal, work, or synthesis" }, { status: 400 });
  }
  if (!text) {
    return NextResponse.json({ error: "text is required" }, { status: 400 });
  }
  if (text.length > 4000) {
    return NextResponse.json({ error: "instructions too long (4000 chars max)" }, { status: 400 });
  }

  try {
    const targets = await targetsFor(scope);
    if (scope === "work" && !targets.length) {
      return NextResponse.json(
        { error: "No ClickUp lists configured — set CLICKUP_LISTS first." },
        { status: 400 }
      );
    }

    const existingRules = await existingRulesFor(scope);
    const { result, model } = await compileInstructions({
      scope,
      userText: text,
      targets,
      existingRules,
    });
    if (!result.compiled.trim()) {
      return NextResponse.json({ compiled: "", label: "", notes: result.notes });
    }

    const db = createSupabaseAdminClient();
    const { data: row, error } = await db
      .from("ai_instructions")
      .insert({
        scope,
        user_text: text,
        compiled_text: result.compiled,
        label: result.label || null,
        is_active: true,
        model,
      })
      .select("id")
      .single();
    if (error || !row) throw new Error(error?.message ?? "insert returned no row");

    return NextResponse.json({
      id: row.id,
      label: result.label,
      compiled: result.compiled,
      notes: result.notes,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "compile failed" },
      { status: 500 }
    );
  }
}
