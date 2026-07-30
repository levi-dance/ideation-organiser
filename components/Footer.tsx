import SyncButton from "@/components/SyncButton";

export default function Footer() {
  return (
    <footer className="mt-20 border-t" style={{ borderColor: "var(--color-hairline)" }}>
      <div
        className="mx-auto flex max-w-3xl flex-col items-center justify-between gap-3 px-6 py-8 text-xs sm:flex-row"
        style={{ color: "var(--color-ink-muted)" }}
      >
        <p>Second Brain — a personal thought-filing tool.</p>
        <SyncButton />
      </div>
    </footer>
  );
}
