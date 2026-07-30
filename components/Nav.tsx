import Link from "next/link";
import { Brain } from "lucide-react";

export default function Nav() {
  return (
    <nav className="sticky top-0 z-10 border-b bg-white/90 backdrop-blur" style={{ borderColor: "var(--color-hairline)" }}>
      <div className="mx-auto flex h-14 max-w-3xl items-center justify-between px-6">
        <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight">
          <span
            className="flex h-7 w-7 items-center justify-center rounded-md"
            style={{ background: "var(--color-nblue-100)", color: "var(--color-nblue-600)" }}
          >
            <Brain size={16} strokeWidth={2.2} />
          </span>
          Second Brain
        </Link>
        <div className="flex items-center gap-5 text-sm font-medium">
          <Link href="/" className="link-quiet">
            Capture
          </Link>
          <Link href="/entries" className="link-quiet">
            Entries
          </Link>
          <Link href="/ask" className="link-quiet">
            Ask
          </Link>
          <Link href="/instructions" className="link-quiet">
            Instructions
          </Link>
        </div>
      </div>
    </nav>
  );
}
