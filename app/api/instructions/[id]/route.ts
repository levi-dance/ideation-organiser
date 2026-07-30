import { NextResponse } from "next/server";
import { createSupabaseAdminClient, createSupabaseServerClient } from "@/lib/supabase/server";
import { compileInstructions, type InstructionScope } from "@/lib/claude/compile-instructions";
import { existingRulesFor, targetsFor } from "@/lib/pipeline/instructions";

export const maxDuration = 60;

async function requireUser() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
}

/** Re-edit one instruction: recompile its new wording, leave every other rule untouched. */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await requireUser())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const body = await request.json().catch(() => null);
  const text = typeof body?.text === "string" ? body.text.trim() : "";
  if (!text) {
    return NextResponse.json({ error: "text is required" }, { status: 400 });
  }
  if (text.length > 4000) {
    return NextResponse.json({ error: "instructions too long (4000 chars max)" }, { status: 400 });
  }

  const db = createSupabaseAdminClient();
  const { data: row } = await db
    .from("ai_instructions")
    .select("id, scope")
    .eq("id", id)
    .maybeSingle();
  if (!row) {
    return NextResponse.json({ error: "Instruction not found" }, { status: 404 });
  }
  const scope = row.scope as InstructionScope;

  try {
    const { result, model } = await compileInstructions({
      scope,
      userText: text,
      targets: await targetsFor(scope),
      existingRules: await existingRulesFor(scope, id),
    });
    if (!result.compiled.trim()) {
      // Nothing actionable — keep the existing saved version.
      return NextResponse.json({ compiled: "", label: "", notes: result.notes });
    }

    const { error } = await db
      .from("ai_instructions")
      .update({
        user_text: text,
        compiled_text: result.compiled,
        label: result.label || null,
        model,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id);
    if (error) throw new Error(error.message);

    return NextResponse.json({ label: result.label, compiled: result.compiled, notes: result.notes });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "compile failed" },
      { status: 500 }
    );
  }
}

/** Delete one instruction permanently. */
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await requireUser())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const db = createSupabaseAdminClient();
  const { error } = await db.from("ai_instructions").delete().eq("id", id);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ deleted: true });
}
