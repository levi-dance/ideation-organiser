import type { SupabaseClient } from "@supabase/supabase-js";
import type { InstructionScope } from "@/lib/claude/compile-instructions";

/**
 * The active compiled instruction block for a pipeline, or null. Soft-fails on
 * any error (including the ai_instructions table not existing yet) — custom
 * instructions must never be able to break filing.
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
      .maybeSingle();
    if (error) return null;
    const text = (data?.compiled_text as string | undefined)?.trim();
    return text || null;
  } catch {
    return null;
  }
}
