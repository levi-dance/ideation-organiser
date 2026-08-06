"use client";

import { useMemo, useState } from "react";
import { Check, Crosshair } from "lucide-react";
import type { TimezoneSource } from "@/lib/settings/app-settings";

type Props = {
  initialTimezone: string;
  source: TimezoneSource;
  tableMissing: boolean;
};

/** Every IANA zone this browser knows, when it is new enough to enumerate them. */
function supportedZones(): string[] {
  const withValues = Intl as typeof Intl & { supportedValuesOf?: (key: string) => string[] };
  try {
    return withValues.supportedValuesOf?.("timeZone") ?? [];
  } catch {
    return [];
  }
}

export default function TimezonePanel({ initialTimezone, source, tableMissing }: Props) {
  const [timezone, setTimezone] = useState(initialTimezone);
  const [saved, setSaved] = useState(initialTimezone);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const zones = useMemo(() => {
    const list = supportedZones();
    // Keep whatever is currently set selectable even if this browser has never
    // heard of it, so saving cannot silently change it to something else.
    return list.length && !list.includes(timezone) ? [timezone, ...list] : list;
  }, [timezone]);

  const dirty = timezone !== saved;
  const preview = useMemo(() => {
    try {
      return new Date().toLocaleString(undefined, {
        timeZone: timezone,
        weekday: "long",
        hour: "numeric",
        minute: "2-digit",
      });
    } catch {
      return null;
    }
  }, [timezone]);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/settings/general", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ timezone }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
      setSaved(timezone);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="card p-5 space-y-4">
      <div>
        <h2 className="text-base font-semibold">Your timezone</h2>
        <p className="text-sm" style={{ color: "var(--color-ink-muted)" }}>
          Decides which days count as your week in the Monday review, and how its dates read.
          Saved here rather than in a setting on the server, so changing it takes effect on the
          next review with no redeploy.
        </p>
      </div>

      {tableMissing && (
        <p className="card border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">
          The app_settings table doesn&rsquo;t exist yet, so this cannot be saved. Run
          supabase/schema.sql in the Supabase SQL Editor, then reload.
        </p>
      )}

      {source === "env" && (
        <p className="card border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">
          This is coming from the <code>APP_TIMEZONE</code> environment variable. Save it here once
          to move it into the app, after which you can delete that variable.
        </p>
      )}

      <div className="flex flex-wrap items-center gap-3">
        {zones.length ? (
          <select
            value={timezone}
            onChange={(e) => setTimezone(e.target.value)}
            className="input-notion !w-auto text-sm"
            aria-label="Timezone"
          >
            {zones.map((z) => (
              <option key={z} value={z}>
                {z}
              </option>
            ))}
          </select>
        ) : (
          <input
            type="text"
            value={timezone}
            onChange={(e) => setTimezone(e.target.value)}
            placeholder="Region/City"
            className="input-notion !w-auto text-sm"
            aria-label="Timezone"
          />
        )}

        <button
          type="button"
          onClick={() => {
            const detected = Intl.DateTimeFormat().resolvedOptions().timeZone;
            if (detected) setTimezone(detected);
          }}
          className="link-quiet inline-flex items-center gap-1.5 text-xs"
        >
          <Crosshair size={12} /> Use this device&rsquo;s timezone
        </button>
      </div>

      {preview && (
        <p className="text-xs" style={{ color: "var(--color-ink-faint)" }}>
          Right now that reads as {preview}.
        </p>
      )}

      {error && <p className="card border-red-300 bg-red-50 p-3 text-sm text-red-700">{error}</p>}

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={save}
          disabled={saving || !dirty || tableMissing}
          className="btn-primary inline-flex h-9 items-center gap-2 px-4 text-sm"
        >
          {!dirty && !saving ? <Check size={13} /> : null}
          {saving ? "Saving…" : dirty ? "Save timezone" : "Saved"}
        </button>
        {dirty && !saving && (
          <span className="text-xs" style={{ color: "var(--color-ink-muted)" }}>
            Unsaved change
          </span>
        )}
      </div>

      <p className="text-xs" style={{ color: "var(--color-ink-faint)" }}>
        Separate from this: the review is generated by a scheduled job whose clock is always UTC.
        If it arrives at an odd hour, change the weekly-synthesis schedule in vercel.json and
        redeploy.
      </p>
    </section>
  );
}
