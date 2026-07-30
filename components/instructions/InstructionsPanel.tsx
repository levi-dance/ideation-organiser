"use client";

import { useState } from "react";
import { Pencil, Plus, Sparkles, Trash2, X } from "lucide-react";

export type InstructionItem = {
  id: string;
  label: string;
  userText: string;
  compiled: string;
};

type Props = {
  scope: "personal" | "work" | "synthesis";
  title: string;
  description: string;
  placeholder: string;
  initialItems: InstructionItem[];
};

function ItemCard({
  item,
  note,
  onSaved,
  onDeleted,
}: {
  item: InstructionItem;
  note: string | null;
  onSaved: (updated: InstructionItem, notes: string | null) => void;
  onDeleted: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(item.userText);
  const [busy, setBusy] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (!text.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/instructions/${item.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: text.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
      if (!data.compiled) {
        setError(data.notes || "Nothing actionable in that wording — kept the saved version.");
        return;
      }
      onSaved(
        { id: item.id, label: data.label || item.label, userText: text.trim(), compiled: data.compiled },
        data.notes ?? null
      );
      setEditing(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/instructions/${item.id}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
      onDeleted();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
      setBusy(false);
      setConfirmingDelete(false);
    }
  }

  return (
    <div className="rounded-md border p-4 space-y-2.5" style={{ borderColor: "var(--color-hairline)" }}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium">{item.label || "Instruction"}</p>
          {!editing && (
            <p className="mt-0.5 text-sm" style={{ color: "var(--color-ink-muted)" }}>
              {item.userText}
            </p>
          )}
        </div>
        {!editing && (
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={() => {
                setEditing(true);
                setConfirmingDelete(false);
                setText(item.userText);
              }}
              className="inline-flex items-center gap-1 text-xs"
              style={{ color: "var(--color-ink-muted)" }}
            >
              <Pencil size={12} /> Edit
            </button>
            {confirmingDelete ? (
              <button
                type="button"
                onClick={remove}
                disabled={busy}
                className="inline-flex items-center gap-1 text-xs font-medium text-red-600"
              >
                <Trash2 size={12} /> {busy ? "Deleting…" : "Really delete?"}
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmingDelete(true)}
                className="inline-flex items-center gap-1 text-xs"
                style={{ color: "var(--color-ink-muted)" }}
              >
                <Trash2 size={12} /> Delete
              </button>
            )}
          </div>
        )}
      </div>

      {editing && (
        <div className="space-y-2">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={3}
            className="w-full resize-y rounded-md border bg-transparent p-3 text-sm outline-none"
            style={{ borderColor: "var(--color-hairline)", color: "var(--color-ink)" }}
          />
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={save}
              disabled={!text.trim() || busy}
              className="btn-primary inline-flex h-9 items-center gap-2 px-3 text-sm"
            >
              <Sparkles size={13} />
              {busy ? "Recompiling…" : "Recompile & save"}
            </button>
            <button
              type="button"
              onClick={() => {
                setEditing(false);
                setError(null);
              }}
              className="inline-flex items-center gap-1 text-xs"
              style={{ color: "var(--color-ink-muted)" }}
            >
              <X size={12} /> Cancel
            </button>
          </div>
        </div>
      )}

      {error && <p className="text-xs text-red-600">{error}</p>}
      {note && (
        <p className="text-xs" style={{ color: "var(--color-ink-muted)" }}>
          {note}
        </p>
      )}

      <details>
        <summary className="cursor-pointer text-xs" style={{ color: "var(--color-ink-muted)" }}>
          What the AI actually follows
        </summary>
        <pre
          className="mt-1.5 whitespace-pre-wrap rounded-md border p-3 text-xs leading-relaxed"
          style={{ borderColor: "var(--color-hairline)", color: "var(--color-ink)" }}
        >
          {item.compiled}
        </pre>
      </details>
    </div>
  );
}

export default function InstructionsPanel({
  scope,
  title,
  description,
  placeholder,
  initialItems,
}: Props) {
  const [items, setItems] = useState<InstructionItem[]>(initialItems);
  const [notesById, setNotesById] = useState<Record<string, string | null>>({});
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [composerNote, setComposerNote] = useState<string | null>(null);

  async function add() {
    if (!draft.trim() || busy) return;
    setBusy(true);
    setError(null);
    setComposerNote(null);
    try {
      const res = await fetch("/api/instructions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scope, text: draft.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
      if (!data.compiled) {
        setComposerNote(data.notes || "Nothing actionable found in that — try being more specific.");
        return;
      }
      const item: InstructionItem = {
        id: data.id,
        label: data.label || "Instruction",
        userText: draft.trim(),
        compiled: data.compiled,
      };
      setItems((prev) => [...prev, item]);
      setNotesById((prev) => ({ ...prev, [item.id]: data.notes ?? null }));
      setDraft("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card p-5 space-y-4">
      <div>
        <h2 className="text-base font-semibold">{title}</h2>
        <p className="text-sm" style={{ color: "var(--color-ink-muted)" }}>
          {description}
        </p>
      </div>

      {items.length > 0 && (
        <div className="space-y-3">
          {items.map((item) => (
            <ItemCard
              key={item.id}
              item={item}
              note={notesById[item.id] ?? null}
              onSaved={(updated, notes) => {
                setItems((prev) => prev.map((i) => (i.id === updated.id ? updated : i)));
                setNotesById((prev) => ({ ...prev, [updated.id]: notes }));
              }}
              onDeleted={() => {
                setItems((prev) => prev.filter((i) => i.id !== item.id));
              }}
            />
          ))}
        </div>
      )}

      <div className="space-y-2">
        <p className="inline-flex items-center gap-1.5 text-xs font-medium" style={{ color: "var(--color-ink-muted)" }}>
          <Plus size={12} /> Add an instruction
        </p>
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={placeholder}
          rows={3}
          className="w-full resize-y rounded-md border bg-transparent p-3 text-sm outline-none"
          style={{ borderColor: "var(--color-hairline)", color: "var(--color-ink)" }}
        />
        <button
          type="button"
          onClick={add}
          disabled={!draft.trim() || busy}
          className="btn-primary inline-flex h-10 items-center gap-2 px-4 text-sm"
        >
          <Sparkles size={14} />
          {busy ? "Compiling…" : "Compile & save"}
        </button>
        {error && <p className="card border-red-300 bg-red-50 p-3 text-sm text-red-700">{error}</p>}
        {composerNote && (
          <p className="text-sm" style={{ color: "var(--color-ink-muted)" }}>
            {composerNote}
          </p>
        )}
      </div>
    </section>
  );
}
