"use client";

import { useState } from "react";
import { RefreshCw } from "lucide-react";
import type { SyncReport } from "@/lib/notion/sync";

export default function SyncButton() {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function sync() {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/sync", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "sync failed");
      const r = data as SyncReport;
      const changes = [
        ...r.createdCategories.map((c) => `+ category ${c}`),
        ...r.createdDestinations.map((d) => `+ ${d}`),
        ...r.renamed,
        ...r.reactivated.map((x) => `↺ ${x}`),
        ...r.deactivated.map((x) => `– ${x}`),
      ];
      setMessage(
        changes.length
          ? `Synced ${r.scanned} Notion items:\n${changes.join("\n")}`
          : `Synced ${r.scanned} Notion items — already up to date.`
      );
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "sync failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="text-right">
      <button
        type="button"
        onClick={sync}
        disabled={busy}
        className="link-quiet inline-flex items-center gap-1.5 text-xs font-medium disabled:opacity-50"
      >
        <RefreshCw size={12} className={busy ? "animate-spin" : ""} />
        {busy ? "Syncing…" : "Sync from Notion"}
      </button>
      {message && (
        <pre
          className="card mt-3 whitespace-pre-wrap p-4 text-left text-xs"
          style={{ color: "var(--color-ink-muted)" }}
        >
          {message}
        </pre>
      )}
    </div>
  );
}
