import Link from "next/link";
import { Compass } from "lucide-react";

/**
 * What a fresh install sees everywhere its taxonomy would otherwise be. Until
 * a structure exists there is nowhere to file, so every capture fails; this
 * points at the one page that fixes it rather than leaving a blank space.
 */
export default function EmptyTaxonomyCard() {
  return (
    <section className="card p-6 text-center space-y-3">
      <span
        className="mx-auto flex h-10 w-10 items-center justify-center rounded-lg"
        style={{ background: "var(--color-nblue-100)", color: "var(--color-nblue-600)" }}
      >
        <Compass size={20} strokeWidth={2} />
      </span>
      <h2 className="text-lg font-semibold tracking-tight">Nowhere to file yet</h2>
      <p className="mx-auto max-w-md text-sm" style={{ color: "var(--color-ink-muted)" }}>
        Your second brain has no structure, so captures have nowhere to land. Setup walks you
        through it: describe your life and work in a paragraph, edit what Claude proposes, and it
        creates the pages in your Notion. A couple of minutes, once.
      </p>
      <Link href="/setup" className="btn-primary mx-auto inline-flex h-10 w-fit px-4 text-sm">
        Set up my second brain
      </Link>
    </section>
  );
}
