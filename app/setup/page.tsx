import Link from "next/link";
import { Database, FileText } from "lucide-react";
import Nav from "@/components/Nav";
import Footer from "@/components/Footer";
import HealthPanel from "@/components/setup/HealthPanel";
import TaxonomyBuilder from "@/components/setup/TaxonomyBuilder";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { notionUrl } from "@/lib/notion/client";
import type { Category, Destination } from "@/lib/types";

export const dynamic = "force-dynamic";

type DestRow = Destination & { category: Category };

export default async function SetupPage() {
  const db = createSupabaseAdminClient();
  // A missing table is a setup problem in its own right, and the health panel
  // below names it; here it just means there is no structure yet.
  const { data } = await db
    .from("destinations")
    .select("*, category:categories(*)")
    .eq("is_active", true)
    .order("title");
  const destinations = (data ?? []) as unknown as DestRow[];

  return (
    <>
      <Nav />
      <main className="mx-auto max-w-3xl px-6 space-y-6">
        <header className="pt-10 space-y-2">
          <h1 className="text-3xl font-semibold tracking-tight">Setup</h1>
          <p className="text-sm" style={{ color: "var(--color-ink-muted)" }}>
            Everything needed to get from a fresh install to a working second brain, without
            touching a terminal.
          </p>
        </header>

        <HealthPanel />

        {destinations.length ? (
          <section className="card p-5 space-y-4">
            <div>
              <h2 className="text-base font-semibold">Your filing structure</h2>
              <p className="text-sm" style={{ color: "var(--color-ink-muted)" }}>
                {destinations.length} place{destinations.length === 1 ? "" : "s"} to file into.
                Notion is in charge of this now: add, rename, or remove pages there, then use Sync
                from Notion at the bottom of this page to catch the app up. Each category&rsquo;s
                description is what steers the filing, and sharper descriptions mean sharper filing.
              </p>
            </div>
            <ul className="space-y-1.5">
              {destinations.map((d) => (
                <li
                  key={d.id}
                  className="flex items-center gap-2.5 rounded-md border px-3 py-2 text-sm"
                  style={{ borderColor: "var(--color-hairline)" }}
                >
                  <span style={{ color: "var(--color-ink-faint)" }}>
                    {d.kind === "bank_database" ? <Database size={14} /> : <FileText size={14} />}
                  </span>
                  <span className="min-w-0 flex-1 truncate">
                    <span style={{ color: "var(--color-ink-muted)" }}>{d.category.name} · </span>
                    <span className="font-medium">{d.title}</span>
                  </span>
                  {d.notion_page_id && (
                    <a
                      href={notionUrl(d.notion_page_id)}
                      target="_blank"
                      rel="noreferrer"
                      className="link-blue shrink-0 text-xs"
                    >
                      open
                    </a>
                  )}
                </li>
              ))}
            </ul>
            <p className="text-sm" style={{ color: "var(--color-ink-muted)" }}>
              Next: teach it about your people and projects on the{" "}
              <Link href="/instructions" className="link-blue">
                Instructions
              </Link>{" "}
              page. That is what lifts filing from reasonable to right.
            </p>
          </section>
        ) : (
          <TaxonomyBuilder />
        )}
      </main>
      <Footer />
    </>
  );
}
