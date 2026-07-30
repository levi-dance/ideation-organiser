/**
 * The ClickUp Lists the Work pathway may file into, configured entirely via the
 * CLICKUP_LISTS env var — a JSON array of:
 *
 *   [{ "listId": "901234567", "name": "Client Content",
 *      "description": "Content pipeline for this client: ideas, posts, production tasks." }]
 *
 * Find real list IDs with `npm run clickup:discover` — never guess them.
 * Descriptions are routing guidance for the classifier; keep them in sync with
 * how the lists are actually used. An optional "key" per list overrides the
 * name-derived routing key (only matters if two lists share a name).
 */

export type ResolvedWorkList = {
  key: string;
  listId: string;
  name: string;
  description: string;
};

function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "list"
  );
}

/**
 * Lists from CLICKUP_LISTS. Empty array when the env var is unset (the Work
 * pathway is optional); throws only on malformed configuration.
 */
export function workLists(): ResolvedWorkList[] {
  const raw = process.env.CLICKUP_LISTS;
  if (!raw?.trim()) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("CLICKUP_LISTS is not valid JSON — see .env.local.example for the format.");
  }
  if (!Array.isArray(parsed) || !parsed.length) {
    throw new Error("CLICKUP_LISTS must be a non-empty JSON array of lists.");
  }
  return parsed.map((item, i) => {
    const l = item as Partial<ResolvedWorkList>;
    if (!l.listId || !l.name || !l.description) {
      throw new Error(
        `CLICKUP_LISTS[${i}] needs "listId", "name", and "description" — see .env.local.example.`
      );
    }
    return {
      key: l.key || slugify(l.name),
      listId: String(l.listId),
      name: l.name,
      description: l.description,
    };
  });
}
