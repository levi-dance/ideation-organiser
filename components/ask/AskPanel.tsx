"use client";

import { useState } from "react";
import Link from "next/link";
import { ExternalLink, Search } from "lucide-react";
import CategoryChip from "@/components/entries/CategoryChip";

type AskSource = {
  n: number;
  entryId: string;
  snippet: string;
  similarity: number;
  notionUrl: string | null;
  destinationTitle: string;
  categoryName: string;
  categorySlug: string;
  createdAt: string;
};

type AskResponse = { answer: string; sources: AskSource[] };

/** Render the answer with [n] markers linked to the source cards below. */
function AnswerText({ answer, sources }: { answer: string; sources: AskSource[] }) {
  const known = new Set(sources.map((s) => s.n));
  const parts = answer.split(/(\[\d+\])/g);
  return (
    <p className="whitespace-pre-wrap text-sm leading-relaxed">
      {parts.map((part, i) => {
        const m = part.match(/^\[(\d+)\]$/);
        if (m && known.has(Number(m[1]))) {
          return (
            <a key={i} href={`#source-${m[1]}`} className="link-blue align-super text-[10px]">
              [{m[1]}]
            </a>
          );
        }
        return <span key={i}>{part}</span>;
      })}
    </p>
  );
}

export default function AskPanel() {
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<AskResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function ask() {
    if (!question.trim() || busy) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: question.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
      setResult(data as AskResponse);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="card overflow-hidden" style={{ boxShadow: "var(--shadow-notion-md)" }}>
        <textarea
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              ask();
            }
          }}
          placeholder="What were my ideas about…"
          rows={3}
          className="w-full resize-none bg-transparent p-5 text-lg outline-none"
          style={{ color: "var(--color-ink)" }}
        />
      </div>

      <button
        type="button"
        onClick={ask}
        disabled={!question.trim() || busy}
        className="btn-primary flex h-12 w-full items-center justify-center gap-2 text-base"
      >
        <Search size={16} />
        {busy ? "Searching your brain…" : "Ask"}
      </button>

      {error && <p className="card border-red-300 bg-red-50 p-3 text-sm text-red-700">{error}</p>}

      {result && (
        <div className="space-y-4 text-left">
          <div className="card p-5">
            <AnswerText answer={result.answer} sources={result.sources} />
          </div>

          {result.sources.length > 0 && (
            <section className="space-y-3">
              <h2 className="text-sm font-medium" style={{ color: "var(--color-ink-muted)" }}>
                Sources
              </h2>
              {result.sources.map((s) => (
                <div key={s.n} id={`source-${s.n}`} className="card p-4 text-sm space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className="text-xs font-medium"
                      style={{ color: "var(--color-ink-muted)" }}
                    >
                      [{s.n}]
                    </span>
                    {s.categoryName && (
                      <CategoryChip slug={s.categorySlug} name={s.categoryName} />
                    )}
                    <span className="font-medium">{s.destinationTitle}</span>
                    {s.createdAt && (
                      <span className="text-xs" style={{ color: "var(--color-ink-muted)" }}>
                        {new Date(s.createdAt).toLocaleDateString()}
                      </span>
                    )}
                  </div>
                  <p style={{ color: "var(--color-ink-muted)" }}>{s.snippet}</p>
                  <p className="flex items-center gap-4 text-xs">
                    <Link href={`/entries/${s.entryId}`} className="link-blue">
                      Open entry
                    </Link>
                    {s.notionUrl && (
                      <a
                        href={s.notionUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="link-blue inline-flex items-center gap-1"
                      >
                        Open in Notion <ExternalLink size={11} />
                      </a>
                    )}
                  </p>
                </div>
              ))}
            </section>
          )}
        </div>
      )}
    </div>
  );
}
