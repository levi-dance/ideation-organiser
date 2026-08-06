"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Check, CircleSlash, RefreshCw, X } from "lucide-react";
import type { HealthCheck, HealthReport } from "@/lib/setup/health";

const LOOK: Record<
  HealthCheck["status"],
  { Icon: typeof Check; color: string; background: string; label: string }
> = {
  ok: {
    Icon: Check,
    color: "var(--color-ngreen-700)",
    background: "var(--color-ngreen-100)",
    label: "Working",
  },
  warn: {
    Icon: AlertTriangle,
    color: "var(--color-nyellow-700)",
    background: "var(--color-nyellow-100)",
    label: "Worth fixing",
  },
  fail: {
    Icon: X,
    color: "var(--color-nred-700)",
    background: "var(--color-nred-100)",
    label: "Broken",
  },
  skipped: {
    Icon: CircleSlash,
    color: "var(--color-ink-faint)",
    background: "var(--color-ngray-200)",
    label: "Not set up",
  },
};

export default function HealthPanel() {
  const [report, setReport] = useState<HealthReport | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const check = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/health");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
      setReport(data as HealthReport);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not run the checks");
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void check();
  }, [check]);

  const broken = report?.checks.filter((c) => c.status === "fail").length ?? 0;

  return (
    <section className="card p-5 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold">Is everything connected?</h2>
          <p className="text-sm" style={{ color: "var(--color-ink-muted)" }}>
            {busy && !report
              ? "Checking each service…"
              : report
                ? report.ready
                  ? "Everything the app needs is working."
                  : `${broken} thing${broken === 1 ? "" : "s"} to fix before capture will work.`
                : "Run the checks to see what is set up."}
          </p>
        </div>
        <button
          type="button"
          onClick={check}
          disabled={busy}
          className="btn-secondary inline-flex h-9 shrink-0 items-center gap-2 px-3 text-sm"
        >
          <RefreshCw size={13} className={busy ? "animate-spin" : ""} />
          {busy ? "Checking…" : "Check again"}
        </button>
      </div>

      {error && <p className="card border-red-300 bg-red-50 p-3 text-sm text-red-700">{error}</p>}

      {report && (
        <ul className="space-y-2">
          {report.checks.map((c) => {
            const look = LOOK[c.status];
            return (
              <li
                key={c.id}
                className="rounded-md border p-3.5"
                style={{ borderColor: "var(--color-hairline)" }}
              >
                <div className="flex items-start gap-3">
                  <span
                    className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full"
                    style={{ background: look.background, color: look.color }}
                    aria-label={look.label}
                  >
                    <look.Icon size={12} strokeWidth={2.6} />
                  </span>
                  <div className="min-w-0 space-y-1">
                    <p className="text-sm font-medium">{c.label}</p>
                    <p className="text-sm" style={{ color: "var(--color-ink-muted)" }}>
                      {c.detail}
                    </p>
                    {/* A remedy on a passing check would just be noise. */}
                    {c.remedy && c.status !== "ok" && (
                      <p
                        className="rounded-md p-2.5 text-sm"
                        style={{ background: "var(--color-ngray-100)", color: "var(--color-ink)" }}
                      >
                        {c.remedy}
                      </p>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {report && (
        <p className="text-xs" style={{ color: "var(--color-ink-faint)" }}>
          Changed an environment variable in Vercel? It only takes effect after the next deploy.
        </p>
      )}
    </section>
  );
}
