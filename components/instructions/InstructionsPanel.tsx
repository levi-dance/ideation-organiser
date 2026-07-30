"use client";

import { useState } from "react";
import { Sparkles, Trash2 } from "lucide-react";

type Props = {
  scope: "personal" | "work" | "synthesis";
  title: string;
  description: string;
  placeholder: string;
  initialText: string;
  initialCompiled: string;
  initialActive: boolean;
};

export default function InstructionsPanel({
  scope,
  title,
  description,
  placeholder,
  initialText,
  initialCompiled,
  initialActive,
}: Props) {
  const [text, setText] = useState(initialText);
  const [compiled, setCompiled] = useState(initialActive ? initialCompiled : "");
  const [notes, setNotes] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(clear = false) {
    if (busy) return;
    setBusy(true);
    setError(null);
    setNotes(null);
    try {
      const res = await fetch("/api/instructions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scope, text: clear ? "" : text.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
      if (clear || data.cleared) {
        setCompiled("");
        setText("");
        setNotes("Cleared — this pipeline is back to its default behavior.");
      } else {
        setCompiled(data.compiled ?? "");
        setNotes(data.notes ?? null);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card p-5 space-y-3">
      <div>
        <h2 className="text-base font-semibold">{title}</h2>
        <p className="text-sm" style={{ color: "var(--color-ink-muted)" }}>
          {description}
        </p>
      </div>

      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={placeholder}
        rows={4}
        className="w-full resize-y rounded-md border bg-transparent p-3 text-sm outline-none"
        style={{ borderColor: "var(--color-hairline)", color: "var(--color-ink)" }}
      />

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => submit(false)}
          disabled={!text.trim() || busy}
          className="btn-primary inline-flex h-10 items-center gap-2 px-4 text-sm"
        >
          <Sparkles size={14} />
          {busy ? "Compiling…" : "Compile & save"}
        </button>
        {compiled && (
          <button
            type="button"
            onClick={() => submit(true)}
            disabled={busy}
            className="inline-flex h-10 items-center gap-1.5 text-sm"
            style={{ color: "var(--color-ink-muted)" }}
          >
            <Trash2 size={13} />
            Clear
          </button>
        )}
      </div>

      {error && <p className="card border-red-300 bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      {notes && (
        <p className="text-sm" style={{ color: "var(--color-ink-muted)" }}>
          {notes}
        </p>
      )}

      {compiled && (
        <div className="space-y-1.5">
          <p className="text-xs font-medium" style={{ color: "var(--color-ink-muted)" }}>
            Active compiled instructions (what the AI actually follows)
          </p>
          <pre
            className="whitespace-pre-wrap rounded-md border p-3 text-xs leading-relaxed"
            style={{ borderColor: "var(--color-hairline)", color: "var(--color-ink)" }}
          >
            {compiled}
          </pre>
        </div>
      )}
    </section>
  );
}
