import Nav from "@/components/Nav";
import Footer from "@/components/Footer";
import CaptureForm from "@/components/capture/CaptureForm";
import WorkspaceGrid from "@/components/WorkspaceGrid";
import EmptyTaxonomyCard from "@/components/setup/EmptyTaxonomyCard";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { workLists } from "@/lib/clickup/lists";

export const dynamic = "force-dynamic";

export default async function CapturePage() {
  const db = createSupabaseAdminClient();
  const [workEnabled, { count }] = await Promise.all([
    workLists().then((lists) => lists.length > 0),
    db.from("destinations").select("*", { count: "exact", head: true }).eq("is_active", true),
  ]);
  // Before a taxonomy exists every capture fails at the first step, so offer the
  // way out of that instead of a box that cannot work yet.
  const ready = (count ?? 0) > 0;

  return (
    <>
      <Nav />
      <main className="mx-auto max-w-3xl px-6">
        <div className="mx-auto max-w-xl pt-14 pb-10 text-center space-y-3">
          <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">
            Your second brain
          </h1>
          <p className="text-lg" style={{ color: "var(--color-ink-muted)" }}>
            Capture every thought. Filed where it belongs.
          </p>
        </div>

        <div className="mx-auto max-w-xl">
          {ready ? (
            /* The Work toggle only appears when ClickUp lists are configured. */
            <CaptureForm workEnabled={workEnabled} />
          ) : (
            <EmptyTaxonomyCard />
          )}
        </div>

        {ready && (
          <div className="mt-16">
            <WorkspaceGrid />
          </div>
        )}
      </main>
      <Footer />
    </>
  );
}
