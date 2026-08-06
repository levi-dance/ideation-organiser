"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Brain, BookOpen, Compass, Menu, Mic, ScrollText, Search, Settings, X } from "lucide-react";

const LINKS = [
  { href: "/", label: "Capture", Icon: Mic },
  { href: "/entries", label: "Entries", Icon: ScrollText },
  { href: "/ask", label: "Ask", Icon: Search },
  { href: "/instructions", label: "Instructions", Icon: BookOpen },
  { href: "/settings", label: "Settings", Icon: Settings },
  { href: "/setup", label: "Setup", Icon: Compass },
];

export default function Nav() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  // Close on outside click and on Escape, so the menu never traps the page.
  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: MouseEvent) {
      if (!wrapperRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  // Navigating to the page you picked should leave the menu closed behind you.
  useEffect(() => setOpen(false), [pathname]);

  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname.startsWith(href);
  const current = LINKS.find((l) => isActive(l.href));

  return (
    <nav
      className="sticky top-0 z-20 border-b bg-white/90 backdrop-blur"
      style={{ borderColor: "var(--color-hairline)" }}
    >
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

        <div className="relative" ref={wrapperRef}>
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            aria-haspopup="menu"
            aria-label={open ? "Close menu" : "Open menu"}
            className="flex h-9 items-center gap-2 rounded-md border px-3 text-sm font-medium transition-colors hover:bg-nblue-100"
            style={{ borderColor: "var(--color-hairline)", color: "var(--color-ink)" }}
          >
            {/* The current page name keeps the collapsed nav from hiding where you are. */}
            <span className="hidden sm:inline" style={{ color: "var(--color-ink-muted)" }}>
              {current?.label ?? "Menu"}
            </span>
            {open ? <X size={17} /> : <Menu size={17} />}
          </button>

          {open && (
            <div
              role="menu"
              aria-label="Pages"
              className="card absolute right-0 top-full z-30 mt-2 w-56 overflow-hidden p-1.5"
            >
              {LINKS.map(({ href, label, Icon }) => {
                const active = isActive(href);
                return (
                  <Link
                    key={href}
                    href={href}
                    role="menuitem"
                    aria-current={active ? "page" : undefined}
                    className="flex items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors hover:bg-nblue-100"
                    style={{
                      color: active ? "var(--color-nblue-600)" : "var(--color-ink)",
                      fontWeight: active ? 600 : 400,
                      background: active ? "var(--color-nblue-100)" : undefined,
                    }}
                  >
                    <Icon size={15} strokeWidth={2} />
                    {label}
                  </Link>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </nav>
  );
}
