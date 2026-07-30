import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { workLists } from "@/lib/clickup/lists";
import type {
  CompileTarget,
  ExistingRule,
  InstructionScope,
} from "@/lib/claude/compile-instructions";

export const INSTRUCTION_SCOPES: InstructionScope[] = ["personal", "work", "synthesis"];

/** The real destination/list names the compiler may pin rules to. */
export async function targetsFor(scope: InstructionScope): Promise<CompileTarget[]> {
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

/** The scope's active rules, optionally excluding one row (when re-editing it). */
export async function existingRulesFor(
  scope: InstructionScope,
  excludeId?: string
): Promise<ExistingRule[]> {
  const db = createSupabaseAdminClient();
  let query = db
    .from("ai_instructions")
    .select("id, label, compiled_text")
    .eq("scope", scope)
    .eq("is_active", true)
    .order("created_at");
  if (excludeId) query = query.neq("id", excludeId);
  const { data } = await query;
  return (data ?? []).map((r) => ({
    label: (r.label as string | null) ?? "",
    compiled: r.compiled_text as string,
  }));
}

/**
 * All active compiled instruction blocks for a pipeline, concatenated in
 * creation order (each block is bullet lines, so the join reads as one list),
 * or null when none. Soft-fails on any error (including the ai_instructions
 * table not existing yet) — custom instructions must never break filing.
 */
export async function activeInstructions(
  db: SupabaseClient,
  scope: InstructionScope
): Promise<string | null> {
  try {
    const { data, error } = await db
      .from("ai_instructions")
      .select("compiled_text")
      .eq("scope", scope)
      .eq("is_active", true)
      .order("created_at");
    if (error) return null;
    const text = (data ?? [])
      .map((r) => (r.compiled_text as string | undefined)?.trim())
      .filter(Boolean)
      .join("\n");
    return text || null;
  } catch {
    return null;
  }
}
