"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Check,
  Database,
  FileText,
  Plus,
  Sparkles,
  Trash2,
  Wand2,
} from "lucide-react";

type Kind = "bank_database" | "document_section";

type EditableDestination = {
  uid: string;
  title: string;
  kind: Kind;
  sectionHeading: string;
  dedupEnabled: boolean;
};

type EditableCategory = {
  key: string;
  name: string;
  description: string;
  parentKey: string;
  isCatchAll: boolean;
  destinations: EditableDestination[];
};

type ProposalResponse = {
  categories: {
    key: string;
    name: string;
    description: string;
    parent_key: string;
    is_catch_all: boolean;
    destinations: {
      title: string;
      kind: Kind;
      section_heading: string;
      dedup_enabled: boolean;
    }[];
  }[];
};

type BuildResponse = {
  categories: number;
  destinations: number;
  syncError: string | null;
};

const EXAMPLES = [
  "I am a freelance video editor. Most of my week is client work for two regular clients, and I post my own short-form videos on Instagram and TikTok. I am also slowly writing a book about creative burnout.",
  "I run a small bakery. I capture supplier notes, recipe ideas, staff issues, and things to buy. I also keep a running list of books people recommend to me.",
  "I am a product designer at a startup. I capture feature ideas, research notes from user calls, and reading recommendations. Outside work I am training for a marathon and keep notes on that.",
];

let uidCounter = 0;
const nextUid = () => `d${++uidCounter}`;

function newDestination(title = ""): EditableDestination {
  return { uid: nextUid(), title, kind: "bank_database", sectionHeading: "", dedupEnabled: false };
}

export default function TaxonomyBuilder() {
  const [step, setStep] = useState<"describe" | "review" | "done">("describe");
  const [about, setAbout] = useState("");
  const [feedback, setFeedback] = useState("");
  const [categories, setCategories] = useState<EditableCategory[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [built, setBuilt] = useState<BuildResponse | null>(null);

  // Top-level categories first, each immediately followed by its children, so
  // the list reads as the tree it is. Anything left over (a parent key pointing
  // nowhere) is shown at the end rather than dropped: an invisible category
  // would still be submitted, and the build would reject it with no way to see
  // which one it meant.
  const ordered = useMemo(() => {
    const tops = categories.filter((c) => !c.parentKey);
    const listed = tops.flatMap((top) => [
      top,
      ...categories.filter((c) => c.parentKey === top.key),
    ]);
    const shown = new Set(listed.map((c) => c.key));
    return [...listed, ...categories.filter((c) => !shown.has(c.key))];
  }, [categories]);

  const hasChildren = useMemo(
    () => new Set(categories.map((c) => c.parentKey).filter(Boolean)),
    [categories]
  );

  function patch(key: string, changes: Partial<EditableCategory>) {
    setCategories((prev) => prev.map((c) => (c.key === key ? { ...c, ...changes } : c)));
  }

  function patchDestination(
    categoryKey: string,
    uid: string,
    changes: Partial<EditableDestination>
  ) {
    editDestinations(categoryKey, (list) =>
      list.map((d) => (d.uid === uid ? { ...d, ...changes } : d))
    );
  }

  /** Add/remove go through the previous state, never the rendered snapshot. */
  function editDestinations(
    categoryKey: string,
    change: (list: EditableDestination[]) => EditableDestination[]
  ) {
    setCategories((prev) =>
      prev.map((c) => (c.key === categoryKey ? { ...c, destinations: change(c.destinations) } : c))
    );
  }

  function removeCategory(key: string) {
    setCategories((prev) =>
      prev
        .filter((c) => c.key !== key)
        // Children of a deleted parent move up rather than vanishing with it.
        .map((c) => (c.parentKey === key ? { ...c, parentKey: "" } : c))
    );
  }

  function addCategory() {
    const key = `custom-${nextUid()}`;
    setCategories((prev) => [
      ...prev,
      {
        key,
        name: "",
        description: "",
        parentKey: "",
        isCatchAll: false,
        destinations: [newDestination()],
      },
    ]);
  }

  async function propose(withFeedback: boolean) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/taxonomy/propose", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ about, feedback: withFeedback ? feedback : "" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
      const proposal = data as ProposalResponse;
      setCategories(
        proposal.categories.map((c) => ({
          key: c.key,
          name: c.name,
          description: c.description,
          parentKey: c.parent_key ?? "",
          isCatchAll: c.is_catch_all,
          destinations: c.destinations.map((d) => ({
            uid: nextUid(),
            title: d.title,
            kind: d.kind,
            sectionHeading: d.section_heading ?? "",
            dedupEnabled: d.dedup_enabled,
          })),
        }))
      );
      setFeedback("");
      setStep("review");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not draft a structure");
    } finally {
      setBusy(false);
    }
  }

  async function build() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/taxonomy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          categories: categories.map((c) => ({
            key: c.key,
            name: c.name,
            description: c.description,
            parentKey: c.parentKey,
            isCatchAll: c.isCatchAll,
            destinations: c.destinations.map((d) => ({
              title: d.title,
              kind: d.kind,
              sectionHeading: d.kind === "document_section" ? d.sectionHeading : "",
              dedupEnabled: d.kind === "bank_database" && d.dedupEnabled,
            })),
          })),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
      setBuilt(data as BuildResponse);
      setStep("done");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not build the structure");
    } finally {
      setBusy(false);
    }
  }

  if (step === "done" && built) {
    return (
      <section className="card p-5 space-y-3">
        <h2 className="inline-flex items-center gap-2 text-base font-semibold">
          <span
            className="flex h-6 w-6 items-center justify-center rounded-full"
            style={{ background: "var(--color-ngreen-100)", color: "var(--color-ngreen-700)" }}
          >
            <Check size={13} strokeWidth={2.6} />
          </span>
          Your second brain is built
        </h2>
        <p className="text-sm" style={{ color: "var(--color-ink-muted)" }}>
          {built.categories} categor{built.categories === 1 ? "y" : "ies"} and {built.destinations}{" "}
          place{built.destinations === 1 ? "" : "s"} to file into, created in your Notion and ready
          to use. From here Notion is in charge: rename, move, or add pages there whenever you like,
          then hit Sync from Notion at the bottom of any page.
        </p>
        {built.syncError && (
          <p className="card border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">
            Everything was created, but reading it back from Notion failed: {built.syncError}. Try
            Sync from Notion at the bottom of this page.
          </p>
        )}
        <Link href="/" className="btn-primary inline-flex h-10 w-fit px-4 text-sm">
          Capture your first thought
        </Link>
      </section>
    );
  }

  if (step === "describe") {
    return (
      <section className="card p-5 space-y-4">
        <div>
          <h2 className="text-base font-semibold">Build your filing structure</h2>
          <p className="text-sm" style={{ color: "var(--color-ink-muted)" }}>
            Describe your life and work the way you would to a new assistant: what you do, who you
            do it for, what you make, and the kinds of things you catch yourself wanting to note
            down. Claude turns that into a starting structure, you edit it, and it gets created in
            your Notion.
          </p>
        </div>

        <textarea
          value={about}
          onChange={(e) => setAbout(e.target.value)}
          rows={7}
          placeholder="I am a…"
          className="w-full resize-y rounded-md border bg-transparent p-3.5 text-sm outline-none"
          style={{ borderColor: "var(--color-hairline)", color: "var(--color-ink)" }}
        />

        <div className="space-y-1.5">
          <p className="text-xs font-medium" style={{ color: "var(--color-ink-muted)" }}>
            Not sure where to start? Tap one and edit it.
          </p>
          {EXAMPLES.map((example) => (
            <button
              key={example}
              type="button"
              onClick={() => setAbout(example)}
              className="w-full rounded-md border px-3 py-2 text-left text-sm transition-colors hover:bg-nblue-100"
              style={{ borderColor: "var(--color-hairline)", color: "var(--color-ink-muted)" }}
            >
              {example}
            </button>
          ))}
        </div>

        {error && <p className="card border-red-300 bg-red-50 p-3 text-sm text-red-700">{error}</p>}

        <button
          type="button"
          onClick={() => propose(false)}
          disabled={busy || about.trim().length < 40}
          className="btn-primary inline-flex h-10 items-center gap-2 px-4 text-sm"
        >
          <Wand2 size={14} className={busy ? "animate-pulse" : ""} />
          {busy ? "Thinking…" : "Propose a structure"}
        </button>
      </section>
    );
  }

  return (
    <section className="space-y-4">
      <div className="card p-5 space-y-2">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold">Check the structure before it is created</h2>
            <p className="text-sm" style={{ color: "var(--color-ink-muted)" }}>
              Nothing exists yet. Rename anything, delete what you do not need, and add what is
              missing. The description under each name is the part that matters most: it is the only
              thing the AI reads when deciding where a thought belongs.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setStep("describe")}
            className="link-quiet inline-flex shrink-0 items-center gap-1 text-xs"
          >
            <ArrowLeft size={12} /> Back
          </button>
        </div>
      </div>

      <div className="space-y-3">
        {ordered.map((c) => (
          <div
            key={c.key}
            className={`card space-y-3 p-4 ${c.parentKey ? "ml-0 sm:ml-8" : ""}`}
            style={c.parentKey ? { borderLeftColor: "var(--color-nblue-300)", borderLeftWidth: 3 } : undefined}
          >
            <div className="flex items-start gap-3">
              <input
                type="text"
                value={c.name}
                onChange={(e) => patch(c.key, { name: e.target.value })}
                placeholder="Category name"
                className="input-notion flex-1 text-sm font-medium"
              />
              {c.isCatchAll ? (
                <span
                  className="mt-2 shrink-0 rounded-md px-2 py-1 text-xs font-medium"
                  style={{ background: "var(--color-nblue-100)", color: "var(--color-nblue-700)" }}
                  title="Anything that fits nowhere else lands here. Every second brain needs one, so this category cannot be removed."
                >
                  Catch-all
                </span>
              ) : (
                <button
                  type="button"
                  onClick={() => removeCategory(c.key)}
                  className="link-quiet mt-2.5 inline-flex shrink-0 items-center gap-1 text-xs"
                >
                  <Trash2 size={12} /> Remove
                </button>
              )}
            </div>

            <textarea
              value={c.description}
              onChange={(e) => patch(c.key, { description: e.target.value })}
              rows={2}
              placeholder="What belongs here, and what does not? Name anything it could be confused with."
              className="w-full resize-y rounded-md border bg-transparent p-3 text-sm outline-none"
              style={{ borderColor: "var(--color-hairline)", color: "var(--color-ink)" }}
            />

            {/* Two levels only, so a category that already holds others cannot
                itself be moved inside a third. */}
            {!hasChildren.has(c.key) && (
              <label className="flex items-center gap-2 text-xs" style={{ color: "var(--color-ink-muted)" }}>
                Sits under
                <select
                  value={c.parentKey}
                  onChange={(e) => patch(c.key, { parentKey: e.target.value })}
                  className="input-notion !w-auto !py-1 text-xs"
                >
                  <option value="">nothing, it is top level</option>
                  {categories
                    .filter((p) => p.key !== c.key && !p.parentKey && !p.isCatchAll)
                    .map((p) => (
                      <option key={p.key} value={p.key}>
                        {p.name || "(unnamed)"}
                      </option>
                    ))}
                </select>
              </label>
            )}

            <div className="space-y-2">
              {c.destinations.map((d) => (
                <div
                  key={d.uid}
                  className="rounded-md border p-3 space-y-2"
                  style={{ borderColor: "var(--color-hairline)" }}
                >
                  <div className="flex items-center gap-2">
                    <span style={{ color: "var(--color-ink-faint)" }}>
                      {d.kind === "bank_database" ? <Database size={14} /> : <FileText size={14} />}
                    </span>
                    <input
                      type="text"
                      value={d.title}
                      onChange={(e) => patchDestination(c.key, d.uid, { title: e.target.value })}
                      placeholder="What is this place called?"
                      className="input-notion flex-1 text-sm"
                    />
                    <button
                      type="button"
                      onClick={() =>
                        editDestinations(c.key, (list) => list.filter((x) => x.uid !== d.uid))
                      }
                      className="link-quiet shrink-0"
                      aria-label={`Remove ${d.title || "this place"}`}
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>

                  <div className="flex flex-wrap items-center gap-3 text-xs" style={{ color: "var(--color-ink-muted)" }}>
                    <select
                      value={d.kind}
                      onChange={(e) =>
                        patchDestination(c.key, d.uid, { kind: e.target.value as Kind })
                      }
                      className="input-notion !w-auto !py-1 text-xs"
                    >
                      <option value="bank_database">A list that collects items</option>
                      <option value="document_section">A document thoughts get added to</option>
                    </select>

                    {d.kind === "bank_database" ? (
                      <label className="flex items-center gap-1.5">
                        <input
                          type="checkbox"
                          checked={d.dedupEnabled}
                          onChange={(e) =>
                            patchDestination(c.key, d.uid, { dedupEnabled: e.target.checked })
                          }
                        />
                        Merge repeats (for shopping-style lists)
                      </label>
                    ) : (
                      <label className="flex items-center gap-1.5">
                        Add under the heading
                        <input
                          type="text"
                          value={d.sectionHeading}
                          onChange={(e) =>
                            patchDestination(c.key, d.uid, { sectionHeading: e.target.value })
                          }
                          placeholder="Notes"
                          className="input-notion !w-36 !py-1 text-xs"
                        />
                      </label>
                    )}
                  </div>
                </div>
              ))}

              <button
                type="button"
                onClick={() => editDestinations(c.key, (list) => [...list, newDestination()])}
                className="link-quiet inline-flex items-center gap-1 text-xs"
              >
                <Plus size={12} /> Add a place to file
              </button>
            </div>
          </div>
        ))}
      </div>

      <button
        type="button"
        onClick={addCategory}
        className="btn-secondary inline-flex h-9 items-center gap-2 px-3 text-sm"
      >
        <Plus size={13} /> Add a category
      </button>

      <div className="card p-5 space-y-3">
        <p className="text-sm font-medium">Want a different shape entirely?</p>
        <textarea
          value={feedback}
          onChange={(e) => setFeedback(e.target.value)}
          rows={2}
          placeholder="Too many categories, and split the client work per client instead of one bucket."
          className="w-full resize-y rounded-md border bg-transparent p-3 text-sm outline-none"
          style={{ borderColor: "var(--color-hairline)", color: "var(--color-ink)" }}
        />
        <button
          type="button"
          onClick={() => propose(true)}
          disabled={busy || !feedback.trim()}
          className="btn-secondary inline-flex h-9 items-center gap-2 px-3 text-sm"
        >
          <Sparkles size={13} />
          {busy ? "Thinking…" : "Propose again with these notes"}
        </button>
        <p className="text-xs" style={{ color: "var(--color-ink-faint)" }}>
          This replaces everything above, including your edits.
        </p>
      </div>

      {error && <p className="card border-red-300 bg-red-50 p-3 text-sm text-red-700">{error}</p>}

      <div className="card p-5 space-y-3">
        <p className="text-sm" style={{ color: "var(--color-ink-muted)" }}>
          Confirming creates a page for every category in your Notion, under the root page you set
          up, with the databases and documents inside them. It takes up to a minute. Nothing is
          overwritten, and anything you dislike can be renamed or deleted in Notion afterwards.
        </p>
        <button
          type="button"
          onClick={build}
          disabled={busy || !categories.length}
          className="btn-primary inline-flex h-11 items-center gap-2 px-5 text-sm"
        >
          <Check size={15} />
          {busy ? "Creating it in Notion…" : "Create this in my Notion"}
        </button>
      </div>
    </section>
  );
}
