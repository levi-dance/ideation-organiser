import { notFound } from "next/navigation";
import { ExternalLink } from "lucide-react";
import Nav from "@/components/Nav";
import Footer from "@/components/Footer";
import StatusBadge from "@/components/entries/StatusBadge";
import CategoryChip from "@/components/entries/CategoryChip";
import DestinationActions from "@/components/entries/DestinationActions";
import RouteWorkActions from "@/components/entries/RouteWorkActions";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { notionUrl } from "@/lib/notion/client";
import { clickupTaskUrl } from "@/lib/clickup/client";
import { workLists } from "@/lib/clickup/lists";
import type {
  Entry,
  EntryDestination,
  Destination,
  Category,
  ClickUpAction,
  WorkRoutingQueueItem,
} from "@/lib/types";

export const dynamic = "force-dynamic";

type EntryDestWithDest = EntryDestination & {
  destination: Destination & { category: Category };
};

export default async function EntryDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const db = createSupabaseAdminClient();

  const { data: entry } = await db.from("entries").select("*").eq("id", id).single<Entry>();
  if (!entry) notFound();

  const [{ data: filed }, { data: allDests }, { data: clickupActions }, { data: heldItems }] =
    await Promise.all([
      db
        .from("entry_destinations")
        .select("*, destination:destinations(*, category:categories(*))")
        .eq("entry_id", id)
        .order("created_at"),
      db
        .from("destinations")
        .select("id, title, category:categories(name)")
        .eq("is_active", true)
        .order("title"),
      db
        .from("clickup_actions")
        .select("*")
        .eq("entry_id", id)
        .order("created_at")
        .returns<ClickUpAction[]>(),
      db
        .from("work_routing_queue")
        .select("*")
        .eq("entry_id", id)
        .order("created_at")
        .returns<WorkRoutingQueueItem[]>(),
    ]);

  // Lists available for manual routing.
  const listOptions = (await workLists()).map((l) => ({ listId: l.listId, name: l.name }));

  const options = (allDests ?? []).map((d) => ({
    id: d.id as string,
    label: `${(d.category as unknown as { name: string } | null)?.name ?? ""} → ${d.title}`,
  }));

  return (
    <>
      <Nav />
      <main className="mx-auto max-w-3xl px-6 space-y-6">
        <header className="pt-10">
          <h1 className="text-3xl font-semibold tracking-tight">Entry</h1>
        </header>

        <section className="card p-5 space-y-3">
          <p className="text-sm whitespace-pre-wrap">
            {entry.edited_transcript ?? entry.raw_transcript}
          </p>
          <p className="text-xs" style={{ color: "var(--color-ink-muted)" }}>
            <StatusBadge status={entry.status} /> · {entry.source} ·{" "}
            {new Date(entry.created_at).toLocaleString()}
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-sm font-medium" style={{ color: "var(--color-ink-muted)" }}>
            Filed to
          </h2>
          {((filed ?? []) as unknown as EntryDestWithDest[]).map((fd) => (
            <div
              key={fd.id}
              className={`card p-5 text-sm space-y-2.5 ${fd.undone_at ? "opacity-50" : ""}`}
            >
              <div className="flex flex-wrap items-center gap-2">
                <CategoryChip
                  slug={fd.destination.category.slug}
                  name={fd.destination.category.name}
                  icon={fd.destination.category.icon}
                  hue={fd.destination.category.hue}
                />
                <span className="font-medium">{fd.destination.title}</span>
                {fd.undone_at && (
                  <span className="text-xs" style={{ color: "var(--color-ink-muted)" }}>
                    undone
                  </span>
                )}
              </div>
              <p style={{ color: "var(--color-ink-muted)" }}>{fd.content_snippet}</p>
              {(fd.development_prompts ?? []).map((prompt, i) => (
                <p key={i} className="text-xs italic text-orange-600">
                  ({prompt})
                </p>
              ))}
              {fd.warning && <p className="text-xs text-amber-600">{fd.warning}</p>}
              {!fd.undone_at && fd.notion_page_id && (
                <a
                  href={notionUrl(fd.notion_page_id)}
                  target="_blank"
                  rel="noreferrer"
                  className="link-blue inline-flex items-center gap-1 text-xs"
                >
                  Open in Notion <ExternalLink size={11} />
                </a>
              )}
              {!fd.undone_at && (
                <DestinationActions
                  entryId={entry.id}
                  entryDestinationId={fd.id}
                  currentDestinationId={fd.destination_id}
                  options={options}
                />
              )}
            </div>
          ))}
          {(clickupActions ?? []).map((a) => (
            <div key={a.id} className="card p-5 text-sm space-y-2.5">
              <div className="flex flex-wrap items-center gap-2">
                <CategoryChip slug={`clickup-${a.list_id}`} name={a.list_name} />
                <span className="font-medium">{a.task_name}</span>
                <span className="text-xs" style={{ color: "var(--color-ink-muted)" }}>
                  {a.action_type === "create_task" ? "new task" : "appended to existing task"}
                </span>
              </div>
              <p style={{ color: "var(--color-ink-muted)" }}>{a.content_snippet}</p>
              {a.warning && <p className="text-xs text-amber-600">{a.warning}</p>}
              <a
                href={clickupTaskUrl(a.task_id)}
                target="_blank"
                rel="noreferrer"
                className="link-blue inline-flex items-center gap-1 text-xs"
              >
                Open in ClickUp <ExternalLink size={11} />
              </a>
            </div>
          ))}
          {(heldItems ?? []).map((h) => (
            <div
              key={h.id}
              className={`card p-5 text-sm space-y-2.5 ${h.status !== "queued" ? "opacity-50" : ""}`}
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{h.title}</span>
                <span className="text-xs" style={{ color: "var(--color-nyellow-700)" }}>
                  {h.status === "queued" ? "held for routing" : h.status}
                </span>
              </div>
              {h.body && <p style={{ color: "var(--color-ink-muted)" }}>{h.body}</p>}
              {h.reason && (
                <p className="text-xs" style={{ color: "var(--color-ink-muted)" }}>
                  {h.reason}
                </p>
              )}
              {h.status === "queued" && (
                <RouteWorkActions
                  entryId={entry.id}
                  queueItemId={h.id}
                  candidateListId={h.candidate_list_id}
                  options={listOptions}
                />
              )}
            </div>
          ))}
          {!filed?.length && !clickupActions?.length && !heldItems?.length && (
            <p className="text-sm" style={{ color: "var(--color-ink-muted)" }}>
              Not filed anywhere (yet).
            </p>
          )}
        </section>
      </main>
      <Footer />
    </>
  );
}
