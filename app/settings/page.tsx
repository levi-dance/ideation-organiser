import Nav from "@/components/Nav";
import Footer from "@/components/Footer";
import WorkListsPanel, { type EditableList } from "@/components/settings/WorkListsPanel";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { clickupTokenConfigured } from "@/lib/clickup/client";
import { envWorkLists } from "@/lib/clickup/lists";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const db = createSupabaseAdminClient();
  const { data, error } = await db
    .from("work_lists")
    .select("list_id, name, description, is_active")
    .order("sort_order");

  const tableMissing = !!error;
  const rows = data ?? [];

  // Any row at all means the user has saved lists here, so the database is
  // authoritative. Only before that do we offer the env var's lists to import.
  const configuredInDb = !tableMissing && rows.length > 0;
  let initialLists: EditableList[] = rows
    .filter((r) => r.is_active)
    .map((r) => ({
      listId: String(r.list_id),
      name: r.name as string,
      description: r.description as string,
    }));
  let envError: string | null = null;

  if (!configuredInDb) {
    try {
      initialLists = envWorkLists().map((l) => ({
        listId: l.listId,
        name: l.name,
        description: l.description,
      }));
    } catch (e) {
      envError = e instanceof Error ? e.message : "CLICKUP_LISTS could not be read";
      initialLists = [];
    }
  }

  return (
    <>
      <Nav />
      <main className="mx-auto max-w-3xl px-6 space-y-6">
        <header className="pt-10 space-y-2">
          <h1 className="text-3xl font-semibold tracking-tight">Settings</h1>
          <p className="text-sm" style={{ color: "var(--color-ink-muted)" }}>
            Configuration you can change without redeploying.
          </p>
        </header>

        {tableMissing && (
          <p className="card border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">
            The work_lists table doesn&rsquo;t exist yet. Run supabase/schema.sql in the Supabase
            SQL Editor, then reload. Until then your lists come from the CLICKUP_LISTS environment
            variable.
          </p>
        )}

        {envError && (
          <p className="card border-red-300 bg-red-50 p-3 text-sm text-red-700">{envError}</p>
        )}

        <WorkListsPanel
          initialLists={initialLists}
          fromEnv={!configuredInDb && initialLists.length > 0}
          tokenConfigured={clickupTokenConfigured()}
        />
      </main>
      <Footer />
    </>
  );
}
