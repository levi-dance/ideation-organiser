import Link from "next/link";
import Nav from "@/components/Nav";
import Footer from "@/components/Footer";
import StatusBadge from "@/components/entries/StatusBadge";
import CategoryChip from "@/components/entries/CategoryChip";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { relativeTime } from "@/lib/design/relative-time";
import type { Entry } from "@/lib/types";

export const dynamic = "force-dynamic";

const FILTERS: { key: string; label: string }[] = [
  { key: "", label: "All" },
  { key: "filed", label: "Filed" },
  { key: "needs_routing", label: "Needs routing" },
  { key: "error", label: "Issues" },
  { key: "retracted", label: "Undone" },
];

type ChipInfo = { slug: string; name: string };

export default async function EntriesPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; q?: string }>;
}) {
  const { status = "", q = "" } = await searchParams;
  const db = createSupabaseAdminClient();

  let query = db
    .from("entries")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(100);
  if (status === "error") query = query.in("status", ["error", "partial_error"]);
  else if (status) query = query.eq("status", status);
  if (q) query = query.ilike("raw_transcript", `%${q}%`);

  const { data: entries } = await query;

  // Category chips per entry (Notion categories + ClickUp lists).
  const ids = (entries ?? []).map((e) => e.id);
  const chips = new Map<string, ChipInfo[]>();
  if (ids.length) {
    const [{ data: filings }, { data: clickupActions }] = await Promise.all([
      db
        .from("entry_destinations")
        .select("entry_id, destination:destinations(category:categories(slug, name))")
        .in("entry_id", ids)
        .is("undone_at", null),
      db.from("clickup_actions").select("entry_id, list_id, list_name").in("entry_id", ids),
    ]);
    for (const f of filings ?? []) {
      const cat = (f.destination as unknown as { category: ChipInfo } | null)?.category;
      if (!cat) continue;
      const list = chips.get(f.entry_id) ?? [];
      if (!list.some((c) => c.slug === cat.slug)) list.push(cat);
      chips.set(f.entry_id, list);
    }
    for (const a of clickupActions ?? []) {
      const chip: ChipInfo = { slug: `clickup-${a.list_id}`, name: a.list_name };
      const list = chips.get(a.entry_id) ?? [];
      if (!list.some((c) => c.slug === chip.slug)) list.push(chip);
      chips.set(a.entry_id, list);
    }
  }

  return (
    <>
      <Nav />
      <main className="mx-auto max-w-3xl px-6 space-y-6">
        <header className="flex items-center justify-between pt-10">
          <h1 className="text-3xl font-semibold tracking-tight">Entries</h1>
        </header>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <form className="flex-1" action="/entries">
            {status && <input type="hidden" name="status" value={status} />}
            <input
              type="search"
              name="q"
              defaultValue={q}
              placeholder="Search entries…"
              className="input-notion"
            />
          </form>
          <nav className="flex gap-2 text-xs font-medium">
            {FILTERS.map((f) => (
              <Link
                key={f.key}
                href={`/entries${f.key ? `?status=${f.key}` : ""}${q ? `${f.key ? "&" : "?"}q=${encodeURIComponent(q)}` : ""}`}
                className={`rounded-full px-3 py-1.5 transition-colors ${
                  status === f.key
                    ? "bg-nblue-100 text-nblue-700"
                    : "border border-[var(--color-hairline)] bg-white"
                }`}
                style={status === f.key ? undefined : { color: "var(--color-ink-muted)" }}
              >
                {f.label}
              </Link>
            ))}
          </nav>
        </div>

        <ul className="space-y-3">
          {(entries ?? []).map((e: Entry) => (
            <li key={e.id}>
              <Link
                href={`/entries/${e.id}`}
                className="card block p-4 transition-shadow hover:[box-shadow:var(--shadow-notion-md)]"
              >
                <p className="line-clamp-2 text-sm">{e.edited_transcript ?? e.raw_transcript}</p>
                <div className="mt-2.5 flex flex-wrap items-center gap-2 text-xs">
                  {(chips.get(e.id) ?? []).map((c) => (
                    <CategoryChip key={c.slug} slug={c.slug} name={c.name} />
                  ))}
                  <span style={{ color: "var(--color-ink-muted)" }}>
                    <StatusBadge status={e.status} /> · {relativeTime(e.created_at)}
                  </span>
                </div>
              </Link>
            </li>
          ))}
          {!entries?.length && (
            <p className="text-sm" style={{ color: "var(--color-ink-muted)" }}>
              {q || status ? "No entries match." : "Nothing captured yet."}
            </p>
          )}
        </ul>
      </main>
      <Footer />
    </>
  );
}
