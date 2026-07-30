"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Option = { id: string; label: string };

export default function DestinationActions({
  entryId,
  entryDestinationId,
  currentDestinationId,
  options,
}: {
  entryId: string;
  entryDestinationId: string;
  currentDestinationId: string;
  options: Option[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [picking, setPicking] = useState(false);
  const [target, setTarget] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function call(path: string, body: Record<string, string>) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "failed");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "failed");
    } finally {
      setBusy(false);
      setPicking(false);
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex gap-4 text-xs font-medium">
        <button
          type="button"
          disabled={busy}
          onClick={() => call(`/api/entries/${entryId}/undo`, { entryDestinationId })}
          className="text-red-600 hover:underline disabled:opacity-50"
        >
          {busy ? "…" : "Undo"}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => setPicking((p) => !p)}
          className="link-blue disabled:opacity-50"
        >
          Reassign
        </button>
      </div>
      {picking && (
        <div className="flex gap-2">
          <select
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            className="input-notion flex-1 text-xs"
          >
            <option value="">Move to…</option>
            {options
              .filter((o) => o.id !== currentDestinationId)
              .map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
          </select>
          <button
            type="button"
            disabled={busy || !target}
            onClick={() =>
              call(`/api/entries/${entryId}/reassign`, {
                entryDestinationId,
                toDestinationId: target,
              })
            }
            className="btn-primary px-4 py-1.5 text-xs"
          >
            Move
          </button>
        </div>
      )}
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}
