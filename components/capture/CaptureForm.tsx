"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Briefcase, Mic, Square, User } from "lucide-react";

type FiledItem = {
  destinationTitle: string;
  categoryName: string;
  title: string;
  notionUrl: string | null;
  warning: string | null;
};

type WorkFiledItem = {
  listName: string;
  action: "create_task" | "append_description";
  title: string;
  taskUrl: string;
};

type IngestResponse = {
  entryId: string;
  scope: "personal" | "work";
  status: "filed" | "partial_error" | "error" | "needs_routing";
  filed: (FiledItem | WorkFiledItem)[];
  held?: { title: string; reason: string }[];
  errors: string[];
  lowConfidence?: boolean;
};

type Scope = "personal" | "work";

// Minimal typings for the (webkit-prefixed) Web Speech API.
type SpeechRecognitionLike = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: { resultIndex: number; results: ArrayLike<{ 0: { transcript: string }; isFinal: boolean }> }) => void) | null;
  onend: (() => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  start: () => void;
  stop: () => void;
};

function getSpeechRecognition(): (new () => SpeechRecognitionLike) | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as Record<string, unknown>;
  return (w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null) as
    | (new () => SpeechRecognitionLike)
    | null;
}

function isWorkItem(f: FiledItem | WorkFiledItem): f is WorkFiledItem {
  return "listName" in f;
}

export default function CaptureForm({ workEnabled = false }: { workEnabled?: boolean }) {
  const [transcript, setTranscript] = useState("");
  const [scope, setScope] = useState<Scope>("personal");
  const [listening, setListening] = useState(false);
  const [speechSupported, setSpeechSupported] = useState(false);
  const [usedVoice, setUsedVoice] = useState(false);
  const [edited, setEdited] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<IngestResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const baseTextRef = useRef("");

  useEffect(() => {
    setSpeechSupported(getSpeechRecognition() !== null);
  }, []);

  function startListening() {
    const SR = getSpeechRecognition();
    if (!SR) return;
    const rec = new SR();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = navigator.language || "en-US";
    baseTextRef.current = transcript ? transcript.trimEnd() + " " : "";
    rec.onresult = (event) => {
      let text = "";
      for (let i = 0; i < event.results.length; i++) {
        text += event.results[i][0].transcript;
      }
      setTranscript(baseTextRef.current + text);
    };
    rec.onend = () => setListening(false);
    rec.onerror = () => setListening(false);
    recognitionRef.current = rec;
    rec.start();
    setListening(true);
    setUsedVoice(true);
    setResult(null);
    setError(null);
  }

  function stopListening() {
    recognitionRef.current?.stop();
    setListening(false);
  }

  async function submit() {
    if (!transcript.trim() || busy) return;
    stopListening();
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/entries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          transcript: transcript.trim(),
          source: usedVoice ? "voice" : "text",
          edited: usedVoice && edited,
          scope,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
      setResult(data as IngestResponse);
      setTranscript("");
      setUsedVoice(false);
      setEdited(false);
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
          value={transcript}
          onChange={(e) => {
            setTranscript(e.target.value);
            if (usedVoice) setEdited(true);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit();
          }}
          placeholder={
            listening ? "Listening…" : "Type a thought, or tap the mic and start talking…"
          }
          rows={5}
          className="w-full resize-none bg-transparent p-5 text-lg outline-none"
          style={{ color: "var(--color-ink)" }}
        />
      </div>

      {/* Manual scope call - never inferred. Personal → Notion, Work → ClickUp.
          Hidden entirely when the ClickUp pathway isn't configured. */}
      {workEnabled && (
      <div
        className="grid grid-cols-2 gap-1 rounded-lg border p-1"
        style={{ borderColor: "var(--color-hairline)" }}
        role="radiogroup"
        aria-label="File as"
      >
        {(
          [
            { value: "personal", label: "Personal", Icon: User },
            { value: "work", label: "Work", Icon: Briefcase },
          ] as const
        ).map(({ value, label, Icon }) => (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={scope === value}
            onClick={() => setScope(value)}
            className={`flex items-center justify-center gap-2 rounded-md py-2 text-sm font-medium transition-colors ${
              scope === value ? "bg-nblue-100 text-nblue-700" : ""
            }`}
            style={scope === value ? undefined : { color: "var(--color-ink-muted)" }}
          >
            <Icon size={15} />
            {label}
          </button>
        ))}
      </div>
      )}

      <div className="flex gap-3">
        {speechSupported && (
          <button
            type="button"
            onClick={listening ? stopListening : startListening}
            className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-full transition-colors ${
              listening ? "bg-red-500 text-white animate-pulse" : "btn-secondary !p-0"
            }`}
            aria-label={listening ? "Stop recording" : "Start recording"}
          >
            {listening ? <Square size={20} fill="currentColor" /> : <Mic size={22} />}
          </button>
        )}
        <button
          type="button"
          onClick={submit}
          disabled={!transcript.trim() || busy}
          className="btn-primary h-14 flex-1 text-base"
        >
          {busy ? "Filing…" : "File it"}
        </button>
      </div>

      {!speechSupported && (
        <p className="text-xs" style={{ color: "var(--color-ink-muted)" }}>
          Voice input isn’t supported in this browser - typing works everywhere.
        </p>
      )}

      {error && (
        <p className="card border-red-300 bg-red-50 p-3 text-sm text-red-700">{error}</p>
      )}

      {result && (
        <div className="card p-5 space-y-3 text-sm text-left">
          <p>
            <span
              className={`inline-block rounded-md px-2 py-1 text-xs font-medium ${
                result.status === "filed"
                  ? "bg-nblue-100 text-nblue-700"
                  : "bg-amber-50 text-amber-700"
              }`}
            >
              {result.status === "filed"
                ? "Filed"
                : result.status === "needs_routing"
                  ? "Needs routing"
                  : "Filed with issues"}
            </span>
            {result.lowConfidence && (
              <span className="ml-2 text-xs" style={{ color: "var(--color-ink-muted)" }}>
                low confidence - landed in the catch-all
              </span>
            )}
          </p>
          <ul className="space-y-1.5">
            {result.filed.map((f, i) =>
              isWorkItem(f) ? (
                <li key={i}>
                  <span style={{ color: "var(--color-ink-muted)" }}>{f.listName} → </span>
                  <span className="font-medium">
                    {f.action === "append_description" ? "added to existing task" : "new task"}
                  </span>
                  <span style={{ color: "var(--color-ink-muted)" }}>: {f.title}</span>{" "}
                  <a href={f.taskUrl} target="_blank" rel="noreferrer" className="link-blue">
                    open
                  </a>
                </li>
              ) : (
                <li key={i}>
                  <span style={{ color: "var(--color-ink-muted)" }}>{f.categoryName} → </span>
                  <span className="font-medium">{f.destinationTitle}</span>
                  <span style={{ color: "var(--color-ink-muted)" }}>: {f.title}</span>
                  {f.notionUrl && (
                    <>
                      {" "}
                      <a href={f.notionUrl} target="_blank" rel="noreferrer" className="link-blue">
                        open
                      </a>
                    </>
                  )}
                </li>
              )
            )}
          </ul>
          {(result.held ?? []).length > 0 && (
            <ul className="space-y-1.5">
              {(result.held ?? []).map((h, i) => (
                <li key={i} className="text-amber-700">
                  Held for routing: <span className="font-medium">{h.title}</span>{" "}
                  <span style={{ color: "var(--color-ink-muted)" }}> - {h.reason}</span>
                </li>
              ))}
            </ul>
          )}
          {result.errors.length > 0 && (
            <ul className="text-red-600">
              {result.errors.map((e, i) => (
                <li key={i}>{e}</li>
              ))}
            </ul>
          )}
          <Link href={`/entries/${result.entryId}`} className="link-blue">
            View in entry log
          </Link>
        </div>
      )}
    </div>
  );
}
