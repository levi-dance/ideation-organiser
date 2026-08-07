"use client";

import { useState } from "react";
import Link from "next/link";
import { Check, RotateCcw, Sparkles } from "lucide-react";
import { categoryStyle, HUES, ICON_POOL } from "@/lib/design/category-style";

export type EditableCategory = {
  id: string;
  name: string;
  description: string;
  icon: string | null;
  hue: string | null;
  destinationTitles: string[];
};

const ICON_NAMES = Object.keys(ICON_POOL);

type Status = { saving: boolean; suggesting: boolean; saved: boolean; error: string | null };
type Saved = { description: string; icon: string | null; hue: string | null };

const IDLE: Status = { saving: false, suggesting: false, saved: false, error: null };

export default function CategoryDescriptionsPanel({
  initialCategories,
}: {
  initialCategories: EditableCategory[];
}) {
  const [categories, setCategories] = useState(initialCategories);
  // What each category looked like when the page loaded or was last saved, so
  // "unsaved" is honest and Revert has something to go back to.
  const [saved, setSaved] = useState<Record<string, Saved>>(
    Object.fromEntries(
      initialCategories.map((c) => [c.id, { description: c.description, icon: c.icon, hue: c.hue }])
    )
  );
  const [status, setStatus] = useState<Record<string, Status>>({});

  const statusFor = (id: string) => status[id] ?? IDLE;
  const setFor = (id: string, patch: Partial<Status>) =>
    setStatus((prev) => ({ ...prev, [id]: { ...(prev[id] ?? IDLE), ...patch } }));

  function patch(id: string, changes: Partial<EditableCategory>) {
    setCategories((prev) => prev.map((c) => (c.id === id ? { ...c, ...changes } : c)));
    setFor(id, { saved: false, error: null });
  }

  const setDescription = (id: string, description: string) => patch(id, { description });

  async function save(category: EditableCategory) {
    setFor(category.id, { saving: true, error: null, saved: false });
    try {
      const res = await fetch(`/api/categories/${category.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          description: category.description,
          icon: category.icon,
          hue: category.hue,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
      setSaved((prev) => ({
        ...prev,
        [category.id]: {
          description: data.description as string,
          icon: (data.icon as string | null) ?? null,
          hue: (data.hue as string | null) ?? null,
        },
      }));
      setFor(category.id, { saving: false, saved: true });
    } catch (e) {
      setFor(category.id, {
        saving: false,
        error: e instanceof Error ? e.message : "Save failed",
      });
    }
  }

  async function suggest(category: EditableCategory) {
    setFor(category.id, { suggesting: true, error: null });
    try {
      const res = await fetch(`/api/categories/${category.id}/suggest`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
      setDescription(category.id, data.description as string);
      setFor(category.id, { suggesting: false });
    } catch (e) {
      setFor(category.id, {
        suggesting: false,
        error: e instanceof Error ? e.message : "Could not draft a description",
      });
    }
  }

  if (!categories.length) {
    return (
      <section className="card p-5 space-y-2">
        <h2 className="text-base font-semibold">How filing decides</h2>
        <p className="text-sm" style={{ color: "var(--color-ink-muted)" }}>
          Nothing to steer yet: your second brain has no structure.{" "}
          <Link href="/setup" className="link-blue">
            Build it on the Setup page
          </Link>
          .
        </p>
      </section>
    );
  }

  return (
    <section className="card p-5 space-y-4">
      <div>
        <h2 className="text-base font-semibold">How filing decides</h2>
        <p className="text-sm" style={{ color: "var(--color-ink-muted)" }}>
          One description per category, and it is the only thing the AI reads when deciding where a
          thought belongs. Things landing in the wrong place is almost always fixed here. Say what
          belongs and what does not, and name anything it could be confused with. Changes take
          effect on your next capture.
        </p>
      </div>

      <div className="space-y-3">
        {categories.map((c) => {
          const s = statusFor(c.id);
          const was = saved[c.id];
          const dirty =
            c.description !== was?.description || c.icon !== was?.icon || c.hue !== was?.hue;
          const style = categoryStyle(c.name, c.name, { icon: c.icon, hue: c.hue });
          return (
            <div
              key={c.id}
              className="rounded-md border p-4 space-y-2.5"
              style={{ borderColor: "var(--color-hairline)" }}
            >
              <div className="flex items-center gap-2.5">
                <span
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg"
                  style={{ background: style.wash, color: style.deep }}
                >
                  <style.Icon size={16} strokeWidth={2} />
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-medium">{c.name}</p>
                  <p className="truncate text-xs" style={{ color: "var(--color-ink-faint)" }}>
                    files into {c.destinationTitles.join(", ")}
                  </p>
                </div>
              </div>

              <textarea
                value={c.description}
                onChange={(e) => setDescription(c.id, e.target.value)}
                rows={3}
                placeholder="What belongs here, and what does not?"
                className="w-full resize-y rounded-md border bg-transparent p-3 text-sm outline-none"
                style={{ borderColor: "var(--color-hairline)", color: "var(--color-ink)" }}
              />

              <details className="text-xs">
                <summary className="cursor-pointer" style={{ color: "var(--color-ink-muted)" }}>
                  Icon and colour
                </summary>
                <div className="mt-2.5 space-y-2.5">
                  <div className="flex flex-wrap gap-1.5">
                    {ICON_NAMES.map((iconName) => {
                      const Icon = ICON_POOL[iconName];
                      const active = c.icon === iconName;
                      return (
                        <button
                          key={iconName}
                          type="button"
                          onClick={() => patch(c.id, { icon: active ? null : iconName })}
                          aria-pressed={active}
                          aria-label={iconName}
                          title={iconName}
                          className="flex h-8 w-8 items-center justify-center rounded-md border transition-colors"
                          style={{
                            borderColor: active ? style.accent : "var(--color-hairline)",
                            background: active ? style.wash : "transparent",
                            color: active ? style.deep : "var(--color-ink-muted)",
                          }}
                        >
                          <Icon size={15} strokeWidth={2} />
                        </button>
                      );
                    })}
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {HUES.map((hueName) => {
                      const swatch = categoryStyle(c.name, c.name, { hue: hueName });
                      const active = c.hue === hueName;
                      return (
                        <button
                          key={hueName}
                          type="button"
                          onClick={() => patch(c.id, { hue: active ? null : hueName })}
                          aria-pressed={active}
                          aria-label={hueName}
                          title={hueName}
                          className="h-6 w-6 rounded-full border-2 transition-transform"
                          style={{
                            background: swatch.accent,
                            borderColor: active ? "var(--color-ink)" : "transparent",
                          }}
                        />
                      );
                    })}
                  </div>
                  <p style={{ color: "var(--color-ink-faint)" }}>
                    Tap a selected one again to clear it and go back to the automatic choice.
                  </p>
                </div>
              </details>

              {s.error && (
                <p className="card border-red-300 bg-red-50 p-2.5 text-sm text-red-700">{s.error}</p>
              )}

              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={() => save(c)}
                  disabled={s.saving || !dirty}
                  className="btn-secondary inline-flex h-8 items-center gap-1.5 px-3 text-xs"
                >
                  {s.saved && !dirty ? <Check size={12} /> : null}
                  {s.saving ? "Saving…" : s.saved && !dirty ? "Saved" : "Save"}
                </button>
                <button
                  type="button"
                  onClick={() => suggest(c)}
                  disabled={s.suggesting}
                  className="link-quiet inline-flex items-center gap-1 text-xs disabled:opacity-50"
                >
                  <Sparkles size={12} />
                  {s.suggesting ? "Reading what is filed here…" : "Suggest from what is filed here"}
                </button>
                {dirty && (
                  <button
                    type="button"
                    onClick={() =>
                      patch(c.id, {
                        description: was?.description ?? "",
                        icon: was?.icon ?? null,
                        hue: was?.hue ?? null,
                      })
                    }
                    className="link-quiet inline-flex items-center gap-1 text-xs"
                  >
                    <RotateCcw size={12} /> Revert
                  </button>
                )}
                {dirty && !s.saving && (
                  <span className="text-xs" style={{ color: "var(--color-ink-muted)" }}>
                    Unsaved
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <p className="text-xs" style={{ color: "var(--color-ink-faint)" }}>
        Category names are not editable here: they mirror your Notion page titles, so rename the
        page in Notion and hit Sync from Notion instead. For rules that cut across categories, and
        for facts about your people and projects, use{" "}
        <Link href="/instructions" className="link-blue">
          Instructions
        </Link>
        .
      </p>
    </section>
  );
}
