import Nav from "@/components/Nav";
import Footer from "@/components/Footer";
import CaptureForm from "@/components/capture/CaptureForm";
import WorkspaceGrid from "@/components/WorkspaceGrid";
import { workLists } from "@/lib/clickup/lists";

export const dynamic = "force-dynamic";

export default function CapturePage() {
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
          {/* The Work toggle only appears when ClickUp lists are configured. */}
          <CaptureForm workEnabled={workLists().length > 0} />
        </div>

        <div className="mt-16">
          <WorkspaceGrid />
        </div>
      </main>
      <Footer />
    </>
  );
}
