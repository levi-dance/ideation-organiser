import Nav from "@/components/Nav";
import Footer from "@/components/Footer";
import InstructionsPanel from "@/components/instructions/InstructionsPanel";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { SYSTEM_PROMPT as PERSONAL_BASE_PROMPT } from "@/lib/claude/classify";
import { WORK_SYSTEM_PROMPT } from "@/lib/claude/classify-work";
import { systemPrompt as synthesisPrompt } from "@/lib/claude/synthesize";
import { workLists } from "@/lib/clickup/lists";

export const dynamic = "force-dynamic";

type Row = {
  scope: "personal" | "work" | "synthesis";
  user_text: string;
  compiled_text: string;
  is_active: boolean;
};

export default async function InstructionsPage() {
  const db = createSupabaseAdminClient();
  let rows: Row[] = [];
  let tableMissing = false;
  const { data, error } = await db
    .from("ai_instructions")
    .select("scope, user_text, compiled_text, is_active");
  if (error) {
    tableMissing = true;
  } else {
    rows = (data ?? []) as Row[];
  }
  const byScope = new Map(rows.map((r) => [r.scope, r]));
  const workConfigured = workLists().length > 0;

  const panel = (scope: Row["scope"]) => {
    const row = byScope.get(scope);
    return {
      initialText: row?.user_text ?? "",
      initialCompiled: row?.compiled_text ?? "",
      initialActive: row?.is_active ?? false,
    };
  };

  return (
    <>
      <Nav />
      <main className="mx-auto max-w-3xl px-6 space-y-6">
        <header className="pt-10">
          <h1 className="text-3xl font-semibold tracking-tight">AI instructions</h1>
          <p className="mt-1 text-sm" style={{ color: "var(--color-ink-muted)" }}>
            Tell the AI about your world in your own words — people, projects, pet peeves. It
            rewrites your wish into precise rules it will follow on every capture, and shows you
            exactly what it saved.
          </p>
        </header>

        {tableMissing && (
          <p className="card border-amber-300 bg-amber-50 p-3 text-sm text-amber-700">
            The ai_instructions table doesn&rsquo;t exist yet — apply
            supabase/migrations/0006_ai_instructions.sql in the Supabase SQL Editor, then reload.
          </p>
        )}

        <InstructionsPanel
          scope="personal"
          title="Personal filing (Notion)"
          description="How captures should be routed, split, titled, and formatted. Name real people and projects — the AI only knows what you tell it here."
          placeholder={
            'e.g. "Anything mentioning my sister Kate is family stuff, not client work. Recipe ideas go to Books to Read until I make a Recipes bank. Keep titles under six words."'
          }
          {...panel("personal")}
        />

        {workConfigured && (
          <InstructionsPanel
            scope="work"
            title="Work filing (ClickUp)"
            description="How work captures pick a list and when they should attach to an existing task."
            placeholder={
              'e.g. "Anything about the website redesign belongs in Ops even if it mentions content. Invoicing or pricing thoughts always go to Ops."'
            }
            {...panel("work")}
          />
        )}

        <InstructionsPanel
          scope="synthesis"
          title="Weekly synthesis"
          description="Who and what your week revolves around, and what the Monday review should emphasize or skip."
          placeholder={
            'e.g. "My clients are Acme and Globex; I also run a newsletter. Always suggest one concrete next step per client, and skip groceries entirely."'
          }
          {...panel("synthesis")}
        />

        <details className="card p-5 text-sm">
          <summary className="cursor-pointer font-medium">
            The built-in instructions (read-only)
          </summary>
          <p className="mt-2 text-xs" style={{ color: "var(--color-ink-muted)" }}>
            Your compiled instructions are added on top of these. They can override routing
            judgment, but not the safety rules (manual Personal/Work choice, hold-don&rsquo;t-guess,
            the ClickUp permission scope, undo).
          </p>
          <div className="mt-3 space-y-4">
            <div>
              <p className="text-xs font-medium" style={{ color: "var(--color-ink-muted)" }}>
                Personal filing
              </p>
              <pre className="mt-1 whitespace-pre-wrap rounded-md border p-3 text-xs leading-relaxed" style={{ borderColor: "var(--color-hairline)" }}>
                {PERSONAL_BASE_PROMPT}
              </pre>
            </div>
            {workConfigured && (
              <div>
                <p className="text-xs font-medium" style={{ color: "var(--color-ink-muted)" }}>
                  Work filing
                </p>
                <pre className="mt-1 whitespace-pre-wrap rounded-md border p-3 text-xs leading-relaxed" style={{ borderColor: "var(--color-hairline)" }}>
                  {WORK_SYSTEM_PROMPT}
                </pre>
              </div>
            )}
            <div>
              <p className="text-xs font-medium" style={{ color: "var(--color-ink-muted)" }}>
                Weekly synthesis
              </p>
              <pre className="mt-1 whitespace-pre-wrap rounded-md border p-3 text-xs leading-relaxed" style={{ borderColor: "var(--color-hairline)" }}>
                {synthesisPrompt(null)}
              </pre>
            </div>
          </div>
        </details>
      </main>
      <Footer />
    </>
  );
}
