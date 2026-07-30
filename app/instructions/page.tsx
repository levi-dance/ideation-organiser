import Nav from "@/components/Nav";
import Footer from "@/components/Footer";
import InstructionsPanel, {
  type InstructionItem,
} from "@/components/instructions/InstructionsPanel";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { SYSTEM_PROMPT as PERSONAL_BASE_PROMPT } from "@/lib/claude/classify";
import { WORK_SYSTEM_PROMPT } from "@/lib/claude/classify-work";
import { systemPrompt as synthesisPrompt } from "@/lib/claude/synthesize";
import { workLists } from "@/lib/clickup/lists";

export const dynamic = "force-dynamic";

type Row = {
  id: string;
  scope: "personal" | "work" | "synthesis";
  label: string | null;
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
    .select("id, scope, label, user_text, compiled_text, is_active")
    .order("created_at");
  if (error) {
    tableMissing = true;
  } else {
    rows = (data ?? []) as Row[];
  }
  const workConfigured = workLists().length > 0;

  const itemsFor = (scope: Row["scope"]): InstructionItem[] =>
    rows
      .filter((r) => r.scope === scope && r.is_active)
      .map((r) => ({
        id: r.id,
        label: r.label ?? "Instruction",
        userText: r.user_text,
        compiled: r.compiled_text,
      }));

  return (
    <>
      <Nav />
      <main className="mx-auto max-w-3xl px-6 space-y-6">
        <header className="pt-10 space-y-3">
          <h1 className="text-3xl font-semibold tracking-tight">AI instructions</h1>
          <p className="text-sm" style={{ color: "var(--color-ink-muted)" }}>
            You do not need any instructions. The tool already splits rambles into separate ideas,
            files one thought to several places when it fits, cleans up speech-to-text, and routes
            by your Notion category descriptions. With this page empty, it works exactly as it would
            if this feature did not exist. Everything below is optional.
          </p>
          <div className="card p-4 text-sm">
            <p className="font-medium">Add an instruction only for something the tool cannot know or guess on its own:</p>
            <ul className="mt-2 space-y-1.5" style={{ color: "var(--color-ink-muted)" }}>
              <li>
                <span className="font-medium" style={{ color: "var(--color-ink)" }}>
                  1. A fact about your world.
                </span>{" "}
                Who a person or project is, and where thoughts about it belong. Example: &ldquo;Kate
                is my sister; anything about her is family, not client work.&rdquo;
              </li>
              <li>
                <span className="font-medium" style={{ color: "var(--color-ink)" }}>
                  2. An override of where something normally lands.
                </span>{" "}
                When your brain works differently from the obvious. Example: &ldquo;Anything for the
                camping trip goes to Gear, even if it sounds like groceries.&rdquo;
              </li>
              <li>
                <span className="font-medium" style={{ color: "var(--color-ink)" }}>
                  3. A style preference for how items are written.
                </span>{" "}
                Title length, tone, how much structure. Example: &ldquo;Keep titles under six
                words.&rdquo;
              </li>
            </ul>
            <p className="mt-2" style={{ color: "var(--color-ink-muted)" }}>
              You do not need instructions for things it already does well: splitting, multi-filing,
              cleaning up, or basic routing. If filing is fine, add nothing.
            </p>
          </div>
        </header>

        {tableMissing && (
          <p className="card border-amber-300 bg-amber-50 p-3 text-sm text-amber-700">
            The ai_instructions table doesn&rsquo;t exist yet. Run supabase/schema.sql in the
            Supabase SQL Editor, then reload.
          </p>
        )}

        <InstructionsPanel
          scope="personal"
          title="Personal filing (Notion)"
          description="Each instruction is its own item: add as many as you like, edit or delete one without touching the others. Name real people and projects; the AI only knows what you tell it here."
          placeholder={'e.g. "Anything mentioning my sister Kate is family stuff, not client work."'}
          initialItems={itemsFor("personal")}
          starterHints={[
            "My clients are Acme and Globex; anything for them goes to their Project Notes, not my own channels, even if it mentions Instagram or YouTube",
            "Book and podcast recommendations go to Books to Read",
            "Keep titles under six words",
          ]}
        />

        {workConfigured && (
          <InstructionsPanel
            scope="work"
            title="Work filing (ClickUp)"
            description="How work captures pick a list and when they should attach to an existing task."
            placeholder={'e.g. "Anything about the website redesign belongs in Ops even if it mentions content."'}
            initialItems={itemsFor("work")}
            starterHints={[
              "Anything about the website redesign belongs in Ops, even if it mentions content",
              "Invoicing or pricing thoughts always go to Ops",
            ]}
          />
        )}

        <InstructionsPanel
          scope="synthesis"
          title="Weekly synthesis"
          description="Who and what your week revolves around, and what the Monday review should emphasize or skip. This is where you tell it who your clients, channels, and projects are."
          placeholder={'e.g. "Always suggest one concrete next step per client, and skip groceries entirely."'}
          initialItems={itemsFor("synthesis")}
          starterHints={[
            "My clients are Acme and Globex; I also run a newsletter and a YouTube channel",
            "Always suggest one concrete next step per client, and skip groceries",
            "Flag any client I've neglected this week",
          ]}
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
