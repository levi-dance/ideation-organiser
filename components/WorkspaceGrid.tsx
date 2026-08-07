import { ArrowUpRight } from "lucide-react";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import EmptyTaxonomyCard from "@/components/setup/EmptyTaxonomyCard";
import { notionUrl } from "@/lib/notion/client";
import { categoryStyle } from "@/lib/design/category-style";
import { relativeTime } from "@/lib/design/relative-time";
import type { Category, Destination } from "@/lib/types";

type DestRow = Destination & { category: Category };
type Filing = {
  destination_id: string;
  content_snippet: string;
  created_at: string;
  notion_page_id: string | null;
};

export default async function WorkspaceGrid() {
  const db = createSupabaseAdminClient();
  const [{ data: destRows }, { data: filings }] = await Promise.all([
    db.from("destinations").select("*, category:categories(*)").eq("is_active", true),
    db
      .from("entry_destinations")
      .select("destination_id, content_snippet, created_at, notion_page_id")
      .is("undone_at", null)
      .order("created_at", { ascending: false })
      .limit(500),
  ]);

  const stats = new Map<string, { count: number; latest: Filing }>();
  for (const f of (filings ?? []) as Filing[]) {
    const s = stats.get(f.destination_id);
    if (s) s.count++;
    else stats.set(f.destination_id, { count: 1, latest: f });
  }

  const dests = ((destRows ?? []) as unknown as DestRow[]).sort((a, b) => {
    const ca = stats.get(a.id)?.latest.created_at ?? "";
    const cb = stats.get(b.id)?.latest.created_at ?? "";
    return cb.localeCompare(ca) || a.title.localeCompare(b.title);
  });

  // An empty taxonomy is the state a fresh install starts in, and capture fails
  // outright until it is fixed. Say so here rather than rendering nothing.
  if (!dests.length) return <EmptyTaxonomyCard />;

  return (
    <section className="space-y-4">
      <h2 className="text-lg font-semibold tracking-tight">Your workspace</h2>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {dests.map((d) => {
          const style = categoryStyle(d.category.slug, `${d.category.name} ${d.title}`, {
            icon: d.category.icon,
            hue: d.category.hue,
          });
          const stat = stats.get(d.id);
          // Banks store their database id in notion_page_id (backfilled by sync);
          // fall back to the most recently filed row so the card still opens Notion.
          const href = d.notion_page_id
            ? notionUrl(d.notion_page_id)
            : stat?.latest.notion_page_id
              ? notionUrl(stat.latest.notion_page_id)
              : null;

          const card = (
            <div className="card group flex h-full flex-col gap-3 p-4 transition-shadow hover:[box-shadow:var(--shadow-notion-md)]">
              <div className="flex items-start justify-between">
                <span
                  className="flex h-9 w-9 items-center justify-center rounded-lg"
                  style={{ background: style.wash, color: style.deep }}
                >
                  <style.Icon size={18} strokeWidth={2} />
                </span>
                {href && (
                  <ArrowUpRight
                    size={16}
                    className="opacity-0 transition-opacity group-hover:opacity-100"
                    style={{ color: "var(--color-ink-faint)" }}
                  />
                )}
              </div>
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold">{d.title}</p>
                <p className="truncate text-xs" style={{ color: "var(--color-ink-muted)" }}>
                  {d.category.name !== d.title && `${d.category.name} · `}
                  {stat ? `${stat.count} item${stat.count === 1 ? "" : "s"}` : "empty"}
                </p>
              </div>
              {stat && (
                <p
                  className="mt-auto truncate border-t pt-2.5 text-xs"
                  style={{ color: "var(--color-ink-muted)", borderColor: "var(--color-hairline)" }}
                >
                  {stat.latest.content_snippet}
                  <span style={{ color: "var(--color-ink-faint)" }}>
                    {" "}
                    · {relativeTime(stat.latest.created_at)}
                  </span>
                </p>
              )}
            </div>
          );

          return href ? (
            <a key={d.id} href={href} target="_blank" rel="noreferrer">
              {card}
            </a>
          ) : (
            <div key={d.id}>{card}</div>
          );
        })}
      </div>
    </section>
  );
}
