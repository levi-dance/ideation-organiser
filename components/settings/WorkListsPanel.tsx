"use client";

import { useMemo, useState } from "react";
import {
  AlertTriangle,
  Check,
  Plus,
  RefreshCw,
  Search,
  Sparkles,
  Trash2,
} from "lucide-react";

export type EditableList = {
  listId: string;
  name: string;
  description: string;
  /** Where the list sits in ClickUp; only known once discovery has run. */
  path?: string;
};

type DiscoveredList = {
  listId: string;
  name: string;
  path: string;
  statuses: string[];
};

type Props = {
  initialLists: EditableList[];
  /** The initial set came from the legacy CLICKUP_LISTS env var, not the database. */
  fromEnv: boolean;
  tokenConfigured: boolean;
};

export default function WorkListsPanel({ initialLists, fromEnv, tokenConfigured }: Props) {
  const [lists, setLists] = useState<EditableList[]>(initialLists);
  const [discovered, setDiscovered] = useState<DiscoveredList[] | null>(null);
  const [picking, setPicking] = useState(false);
  const [discovering, setDiscovering] = useState(false);
  const [saving, setSaving] = useState(false);
  const [suggestingId, setSuggestingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [dirty, setDirty] = useState(fromEnv);
  const [filter, setFilter] = useState("");

  const configuredIds = useMemo(() => new Set(lists.map((l) => l.listId)), [lists]);
  const available = (discovered ?? []).filter((d) => !configuredIds.has(d.listId));
  // A real workspace can hold dozens of lists, so let the user narrow by name
  // or by where the list sits.
  const needle = filter.trim().toLowerCase();
  const unadded = needle
    ? available.filter(
        (d) =>
          d.name.toLowerCase().includes(needle) || d.path.toLowerCase().includes(needle)
      )
    : available;
  const discoveredIds = useMemo(
    () => (discovered ? new Set(discovered.map((d) => d.listId)) : null),
    [discovered]
  );

  function update(listId: string, patch: Partial<EditableList>) {
    setLists((prev) => prev.map((l) => (l.listId === listId ? { ...l, ...patch } : l)));
    setDirty(true);
    setSaved(false);
  }

  async function discover() {
    setDiscovering(true);
    setError(null);
    try {
      const res = await fetch("/api/settings/clickup/discover");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
      setDiscovered(data.lists as DiscoveredList[]);
      setPicking(true);
      // Backfill the location of lists that were configured before discovery.
      setLists((prev) =>
        prev.map((l) => {
          const match = (data.lists as DiscoveredList[]).find((d) => d.listId === l.listId);
          return match ? { ...l, path: match.path, name: match.name } : l;
        })
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not reach ClickUp");
    } finally {
      setDiscovering(false);
    }
  }

  async function suggest(list: EditableList) {
    setSuggestingId(list.listId);
    setError(null);
    try {
      const res = await fetch("/api/settings/clickup/suggest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ listId: list.listId, name: list.name, path: list.path ?? "" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
      update(list.listId, { description: data.description as string });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not draft a description");
    } finally {
      setSuggestingId(null);
    }
  }

  async function save() {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const res = await fetch("/api/settings/clickup", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lists: lists.map((l) => ({
            listId: l.listId,
            name: l.name,
            description: l.description.trim(),
          })),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
      setDirty(false);
      setSaved(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  if (!tokenConfigured) {
    return (
      <section className="card p-5 space-y-2">
        <h2 className="text-base font-semibold">Work filing (ClickUp)</h2>
        <p className="text-sm" style={{ color: "var(--color-ink-muted)" }}>
          Optional. Set <code>CLICKUP_API_TOKEN</code> in your environment (ClickUp Settings, Apps,
          API Token) and redeploy, then come back here to choose which lists work captures may be
          filed into. Until then the Work toggle stays hidden and every capture goes to Notion.
        </p>
      </section>
    );
  }

  return (
    <section className="card p-5 space-y-4">
      <div>
        <h2 className="text-base font-semibold">Work filing (ClickUp)</h2>
        <p className="text-sm" style={{ color: "var(--color-ink-muted)" }}>
          The lists a work capture may be filed into. Made a new list in ClickUp? Find it below,
          add it, and describe it. Changes take effect on your next capture.
        </p>
      </div>

      {fromEnv && (
        <p className="card border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">
          These came from your <code>CLICKUP_LISTS</code> environment variable. Save them here once
          to move them into the app, after which you can delete that variable and manage lists on
          this page instead.
        </p>
      )}

      <div className="space-y-3">
        {lists.map((list) => {
          const missing = discoveredIds ? !discoveredIds.has(list.listId) : false;
          return (
            <div
              key={list.listId}
              className="rounded-md border p-4 space-y-2.5"
              style={{ borderColor: "var(--color-hairline)" }}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium">{list.name}</p>
                  <p className="truncate text-xs" style={{ color: "var(--color-ink-faint)" }}>
                    {list.path ? `${list.path} · ` : ""}id {list.listId}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setLists((prev) => prev.filter((l) => l.listId !== list.listId));
                    setDirty(true);
                    setSaved(false);
                  }}
                  className="inline-flex shrink-0 items-center gap-1 text-xs"
                  style={{ color: "var(--color-ink-muted)" }}
                >
                  <Trash2 size={12} /> Remove
                </button>
              </div>

              {missing && (
                <p className="inline-flex items-center gap-1.5 text-xs text-amber-700">
                  <AlertTriangle size={12} />
                  ClickUp no longer returns this list. Remove it, or filing here will fail.
                </p>
              )}

              <textarea
                value={list.description}
                onChange={(e) => update(list.listId, { description: e.target.value })}
                rows={2}
                placeholder="What belongs in this list? This is what the AI reads to route work here."
                className="w-full resize-y rounded-md border bg-transparent p-3 text-sm outline-none"
                style={{ borderColor: "var(--color-hairline)", color: "var(--color-ink)" }}
              />
              <button
                type="button"
                onClick={() => suggest(list)}
                disabled={suggestingId === list.listId}
                className="inline-flex items-center gap-1 text-xs disabled:opacity-50"
                style={{ color: "var(--color-ink-muted)" }}
              >
                <Sparkles size={12} />
                {suggestingId === list.listId ? "Reading the list…" : "Suggest from tasks in the list"}
              </button>
            </div>
          );
        })}

        {!lists.length && (
          <p className="text-sm" style={{ color: "var(--color-ink-muted)" }}>
            No lists configured yet, so the Work toggle is hidden and every capture goes to Notion.
          </p>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={discover}
          disabled={discovering}
          className="btn-secondary inline-flex h-9 items-center gap-2 px-3 text-sm"
        >
          {discovering ? <RefreshCw size={13} className="animate-spin" /> : <Search size={13} />}
          {discovering ? "Reading ClickUp…" : discovered ? "Refresh from ClickUp" : "Find my lists"}
        </button>
        <button
          type="button"
          onClick={save}
          disabled={saving || !dirty}
          className="btn-primary inline-flex h-9 items-center gap-2 px-4 text-sm"
        >
          {saved && !dirty ? <Check size={13} /> : null}
          {saving ? "Saving…" : saved && !dirty ? "Saved" : "Save lists"}
        </button>
        {dirty && !saving && (
          <span className="text-xs" style={{ color: "var(--color-ink-muted)" }}>
            Unsaved changes
          </span>
        )}
      </div>

      {error && <p className="card border-red-300 bg-red-50 p-3 text-sm text-red-700">{error}</p>}

      {picking && discovered && (
        <div className="space-y-2 border-t pt-4" style={{ borderColor: "var(--color-hairline)" }}>
          <p className="text-xs font-medium" style={{ color: "var(--color-ink-muted)" }}>
            {available.length
              ? `${available.length} more list${available.length === 1 ? "" : "s"} in your ClickUp`
              : "Every list in your ClickUp is already configured."}
          </p>
          {available.length > 8 && (
            <input
              type="text"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Filter by list or folder name…"
              className="input-notion text-sm"
            />
          )}
          <div className="space-y-1.5">
            {unadded.map((d) => (
              <button
                key={d.listId}
                type="button"
                onClick={() => {
                  setLists((prev) => [
                    ...prev,
                    { listId: d.listId, name: d.name, path: d.path, description: "" },
                  ]);
                  setDirty(true);
                  setSaved(false);
                }}
                className="flex w-full items-center gap-2 rounded-md border px-3 py-2 text-left text-sm transition-colors hover:bg-nblue-100"
                style={{ borderColor: "var(--color-hairline)" }}
              >
                <Plus size={13} style={{ color: "var(--color-ink-faint)" }} />
                <span className="min-w-0 flex-1">
                  <span className="font-medium">{d.name}</span>
                  <span className="ml-2 text-xs" style={{ color: "var(--color-ink-faint)" }}>
                    {d.path}
                  </span>
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
