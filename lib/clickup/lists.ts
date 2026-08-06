/**
 * The ClickUp Lists the Work pathway may file into.
 *
 * Source of truth is the work_lists table, managed on the Settings page - add
 * a list in ClickUp, tick it in Settings, and it takes effect on the next
 * capture with no redeploy.
 *
 * The CLICKUP_LISTS env var is the legacy fallback, used only while work_lists
 * is empty (or missing, on a database that predates it). Its format:
 *
 *   [{ "listId": "901234567", "name": "Client Content",
 *      "description": "Content pipeline for this client: ideas, posts, production tasks." }]
 *
 * Settings offers a one-click import of those rows; once saved, the table wins
 * and the env var can be deleted. Descriptions are routing guidance for the
 * classifier, so they are required in both sources.
 */
import { createSupabaseAdminClient } from "@/lib/supabase/server";

export type ResolvedWorkList = {
  key: string;
  listId: string;
  name: string;
  description: string;
};

export function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "list"
  );
}

/** Routing keys derived from names, de-duplicated so two lists never collide. */
export function assignKeys<T extends { name: string; key?: string }>(
  lists: T[]
): (T & { key: string })[] {
  const seen = new Set<string>();
  return lists.map((l) => {
    const base = l.key?.trim() || slugify(l.name);
    let key = base;
    for (let n = 2; seen.has(key); n++) key = `${base}-${n}`;
    seen.add(key);
    return { ...l, key };
  });
}

/**
 * Lists configured in the database, or null when the table is unavailable or
 * has never been saved - which is the signal to fall back to the env var.
 * Never throws: a settings problem must not break page rendering or filing.
 */
async function listsFromDb(): Promise<ResolvedWorkList[] | null> {
  try {
    const db = createSupabaseAdminClient();
    const { data, error } = await db
      .from("work_lists")
      .select("list_id, key, name, description, is_active")
      .order("sort_order");
    if (error || !data || !data.length) return null;
    return data
      .filter((r) => r.is_active)
      .map((r) => ({
        key: r.key as string,
        listId: String(r.list_id),
        name: r.name as string,
        description: r.description as string,
      }));
  } catch {
    return null;
  }
}

/**
 * Lists from the legacy CLICKUP_LISTS env var. Empty array when unset (the
 * Work pathway is optional); throws only on malformed configuration.
 */
export function envWorkLists(): ResolvedWorkList[] {
  const raw = process.env.CLICKUP_LISTS;
  if (!raw?.trim()) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("CLICKUP_LISTS is not valid JSON - see .env.local.example for the format.");
  }
  if (!Array.isArray(parsed) || !parsed.length) {
    throw new Error("CLICKUP_LISTS must be a non-empty JSON array of lists.");
  }
  const validated = parsed.map((item, i) => {
    const l = item as Partial<ResolvedWorkList>;
    if (!l.listId || !l.name || !l.description) {
      throw new Error(
        `CLICKUP_LISTS[${i}] needs "listId", "name", and "description" - see .env.local.example.`
      );
    }
    return { key: l.key, listId: String(l.listId), name: l.name, description: l.description };
  });
  return assignKeys(validated);
}

/** The lists in force right now: the database when configured, else the env var. */
export async function workLists(): Promise<ResolvedWorkList[]> {
  return (await listsFromDb()) ?? envWorkLists();
}

/** Whether workLists() is currently answering from the database. */
export async function workListsAreInDb(): Promise<boolean> {
  return (await listsFromDb()) !== null;
}
