import Nav from "@/components/Nav";
import Footer from "@/components/Footer";
import AskPanel from "@/components/ask/AskPanel";

export default function AskPage() {
  return (
    <>
      <Nav />
      <main className="mx-auto max-w-3xl px-6 space-y-6">
        <header className="pt-10">
          <h1 className="text-3xl font-semibold tracking-tight">Ask your brain</h1>
          <p className="mt-1 text-sm" style={{ color: "var(--color-ink-muted)" }}>
            Search everything you&rsquo;ve ever filed, in your own words.
          </p>
        </header>
        <AskPanel />
      </main>
      <Footer />
    </>
  );
}
