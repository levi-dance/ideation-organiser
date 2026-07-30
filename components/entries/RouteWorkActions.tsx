"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type ListOption = { listId: string; name: string };

/** Manual routing for a held Work idea: pick a ClickUp list, file it there. */
export default function RouteWorkActions({
  entryId,
  queueItemId,
  candidateListId,
  options,
}: {
  entryId: string;
  queueItemId: string;
  candidateListId: string | null;
  options: ListOption[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [target, setTarget] = useState(candidateListId ?? "");
  const [error, setError] = useState<string | null>(null);

  async function route() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/entries/${entryId}/route-work`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ queueItemId, listId: target }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "failed");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <select
          value={target}
          onChange={(e) => setTarget(e.target.value)}
          className="input-notion flex-1 text-xs"
        >
          <option value="">File to list…</option>
          {options.map((o) => (
            <option key={o.listId} value={o.listId}>
              {o.name}
            </option>
          ))}
        </select>
        <button
          type="button"
          disabled={busy || !target}
          onClick={route}
          className="btn-primary px-4 py-1.5 text-xs"
        >
          {busy ? "…" : "File it"}
        </button>
      </div>
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}
