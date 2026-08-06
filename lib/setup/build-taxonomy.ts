/**
 * Turn a confirmed taxonomy plan into a real second brain: create the structure
 * in Notion under NOTION_ROOT_PAGE_ID, mirror it into categories/destinations,
 * then reconcile through runNotionSync() so Notion stays the source of truth.
 *
 * This is the no-terminal replacement for scripts/seed-taxonomy.ts. It only
 * ever runs against an empty taxonomy (see assertBuildable): building on top of
 * an existing one is what the Sync button is for.
 *
 * Notion mapping, chosen so a later sync reads the structure back unchanged:
 *   category            -> a plain page (a container, because it holds things)
 *   bank_database       -> a database inside its category's page
 *   document_section    -> a plain childless page inside its category's page
 * Sync classifies a childless page as a document destination and a page with
 * children as a category, which is exactly what this produces.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { notion } from "@/lib/notion/client";
import { createBankDatabase, createContainerPage, createSectionHeading } from "@/lib/notion/write";
import { runNotionSync, type SyncReport } from "@/lib/notion/sync";

/** The catch-all's slug is load-bearing: lib/pipeline/ingest.ts routes to it. */
export const CATCH_ALL_SLUG = "general-notes";

export type PlannedDestination = {
  title: string;
  kind: "bank_database" | "document_section";
  sectionHeading: string;
  dedupEnabled: boolean;
};

export type PlannedCategory = {
  key: string;
  name: string;
  description: string;
  parentKey: string;
  isCatchAll: boolean;
  destinations: PlannedDestination[];
};

export type BuildReport = {
  categories: number;
  destinations: number;
  sync: SyncReport | null;
  /** Notion succeeded but the follow-up sync did not; the taxonomy is still live. */
  syncError: string | null;
};

const MAX_CATEGORIES = 40;
const MAX_DESTINATIONS_PER_CATEGORY = 8;
const MAX_DEPTH = 3;

export class BuildValidationError extends Error {}

function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "category"
  );
}

/**
 * Reject anything that would produce a broken structure. The UI prevents most
 * of this, but the plan arrives over HTTP and creating Notion pages is not
 * something to half-do and unwind.
 */
export function validatePlan(categories: PlannedCategory[]): void {
  if (!categories.length) {
    throw new BuildValidationError("The plan has no categories.");
  }
  if (categories.length > MAX_CATEGORIES) {
    throw new BuildValidationError(
      `That is ${categories.length} categories. Keep it under ${MAX_CATEGORIES} for a first structure; you can add more in Notion later and hit Sync.`
    );
  }

  const byKey = new Map<string, PlannedCategory>();
  for (const c of categories) {
    if (!c.key.trim()) throw new BuildValidationError("Every category needs an internal key.");
    if (byKey.has(c.key)) throw new BuildValidationError(`Two categories share the key "${c.key}".`);
    byKey.set(c.key, c);
  }

  const names = new Set<string>();
  for (const c of categories) {
    if (!c.name.trim()) throw new BuildValidationError("Every category needs a name.");
    const nameKey = c.name.trim().toLowerCase();
    if (names.has(nameKey)) {
      throw new BuildValidationError(
        `Two categories are both called "${c.name.trim()}". Names have to be distinct.`
      );
    }
    names.add(nameKey);

    if (!c.description.trim()) {
      throw new BuildValidationError(
        `"${c.name}" needs a description. It is the only thing the AI reads when deciding what belongs there.`
      );
    }
    if (c.destinations.length > MAX_DESTINATIONS_PER_CATEGORY) {
      throw new BuildValidationError(
        `"${c.name}" has ${c.destinations.length} destinations. Keep it to ${MAX_DESTINATIONS_PER_CATEGORY} or fewer.`
      );
    }
    for (const d of c.destinations) {
      if (!d.title.trim()) throw new BuildValidationError(`A destination in "${c.name}" has no name.`);
    }

    // Depth, and parents that do not exist or loop back on themselves.
    let depth = 1;
    const seen = new Set<string>([c.key]);
    let parentKey = c.parentKey;
    while (parentKey) {
      const parent = byKey.get(parentKey);
      if (!parent) {
        throw new BuildValidationError(`"${c.name}" sits under a category that is not in the plan.`);
      }
      if (seen.has(parent.key)) {
        throw new BuildValidationError(`"${c.name}" is nested inside itself.`);
      }
      seen.add(parent.key);
      if (++depth > MAX_DEPTH) {
        throw new BuildValidationError(
          `"${c.name}" is nested more than ${MAX_DEPTH} levels deep. Flatten it.`
        );
      }
      parentKey = parent.parentKey;
    }
  }

  const hasChild = new Set(categories.map((c) => c.parentKey).filter(Boolean));
  for (const c of categories) {
    // A childless category with no destinations would become a bare Notion page,
    // which a later sync reads back as a document destination the classifier
    // then files real thoughts into.
    if (!c.destinations.length && !hasChild.has(c.key)) {
      throw new BuildValidationError(
        `"${c.name}" has nothing under it. Give it a place to file into, or remove it.`
      );
    }
  }

  const catchAlls = categories.filter((c) => c.isCatchAll);
  if (catchAlls.length !== 1) {
    throw new BuildValidationError(
      "Exactly one category has to be the catch-all, so a thought that fits nothing else still lands somewhere."
    );
  }
  if (!catchAlls[0].destinations.length) {
    throw new BuildValidationError(`The catch-all "${catchAlls[0].name}" needs a place to file into.`);
  }
}

/**
 * Whether a taxonomy can be created right now. Refuses once anything active
 * exists rather than layering a second structure on top of the first.
 */
export async function assertBuildable(db: SupabaseClient): Promise<void> {
  const { count, error } = await db
    .from("destinations")
    .select("*", { count: "exact", head: true })
    .eq("is_active", true);
  if (error) {
    throw new BuildValidationError(
      `Could not read the destinations table: ${error.message}. Run supabase/schema.sql in the Supabase SQL Editor first.`
    );
  }
  if (count && count > 0) {
    throw new BuildValidationError(
      "This app already has a taxonomy. To change it, restructure your workspace in Notion and use Sync from Notion at the bottom of any page."
    );
  }
}

/**
 * Create the plan for real. A failure part way through is undone completely:
 * the Notion pages created so far go to Notion's trash and the taxonomy rows
 * are deleted, so the retry sees an empty install again rather than being
 * turned away by assertBuildable with half a structure sitting in Notion.
 */
export async function buildTaxonomy(categories: PlannedCategory[]): Promise<BuildReport> {
  const rootId = process.env.NOTION_ROOT_PAGE_ID;
  if (!rootId) {
    throw new BuildValidationError(
      "NOTION_ROOT_PAGE_ID is not set, so there is nowhere to create your structure."
    );
  }

  validatePlan(categories);
  const db = createSupabaseAdminClient();
  await assertBuildable(db);

  // Parents before children, so a category's Notion page exists by the time its
  // children need somewhere to live.
  const ordered = topoSort(categories);
  const usedSlugs = new Set<string>();
  const notionPageByKey = new Map<string, string>();
  const categoryIdByKey = new Map<string, string>();
  // Only the pages created directly under the root need undoing: trashing one
  // takes its whole subtree, databases included.
  const rootLevelPageIds: string[] = [];
  let destinationCount = 0;

  try {
    for (const c of ordered) {
      const parentPageId = c.parentKey ? notionPageByKey.get(c.parentKey) : undefined;
      const pageId = await createContainerPage(parentPageId ?? rootId, c.name.trim());
      notionPageByKey.set(c.key, pageId);
      if (!parentPageId) rootLevelPageIds.push(pageId);

      let slug = c.isCatchAll ? CATCH_ALL_SLUG : slugify(c.name);
      for (let n = 2; usedSlugs.has(slug); n++) slug = `${slugify(c.name)}-${n}`;
      usedSlugs.add(slug);

      const { data: row, error } = await db
        .from("categories")
        .insert({
          slug,
          name: c.name.trim(),
          description: c.description.trim(),
          parent_category_id: c.parentKey ? (categoryIdByKey.get(c.parentKey) ?? null) : null,
          notion_page_id: pageId,
          is_seed: true,
          created_by: "user",
        })
        .select("id")
        .single();
      if (error || !row) {
        throw new Error(`Could not save "${c.name}": ${error?.message ?? "no row returned"}`);
      }
      categoryIdByKey.set(c.key, row.id);

      for (const d of c.destinations) {
        const title = d.title.trim();
        let insert: Record<string, unknown>;
        if (d.kind === "bank_database") {
          const { dataSourceId, databaseId } = await createBankDatabase(pageId, title);
          insert = {
            kind: "bank_database",
            notion_database_id: dataSourceId,
            notion_page_id: databaseId,
            notion_section_heading: null,
          };
        } else {
          const docPageId = await createContainerPage(pageId, title);
          const heading = d.sectionHeading.trim();
          if (heading) await createSectionHeading(docPageId, heading);
          insert = {
            kind: "document_section",
            notion_database_id: null,
            notion_page_id: docPageId,
            notion_section_heading: heading || null,
          };
        }

        const { error: destError } = await db.from("destinations").insert({
          ...insert,
          category_id: row.id,
          title,
          dedup_enabled: d.kind === "bank_database" && d.dedupEnabled,
          created_by: "user",
        });
        if (destError) throw new Error(`Could not save "${title}": ${destError.message}`);
        destinationCount++;
      }
    }
  } catch (e) {
    await rollback(db, rootLevelPageIds, [...categoryIdByKey.values()]);
    throw e;
  }

  // Reconcile: Notion is the source of truth from here on, and this also proves
  // the integration can read back everything it just wrote.
  let sync: SyncReport | null = null;
  let syncError: string | null = null;
  try {
    sync = await runNotionSync();
  } catch (e) {
    syncError = e instanceof Error ? e.message : String(e);
  }

  return {
    categories: ordered.length,
    destinations: destinationCount,
    sync,
    syncError,
  };
}

/**
 * Undo a failed build. Best effort throughout: the original failure is what the
 * user needs to see, so nothing here is allowed to throw over the top of it.
 * Anything that does survive is recoverable, since Notion pages go to the trash
 * rather than being destroyed.
 */
async function rollback(
  db: SupabaseClient,
  notionPageIds: string[],
  categoryIds: string[]
): Promise<void> {
  for (const pageId of [...notionPageIds].reverse()) {
    try {
      await notion().pages.update({ page_id: pageId, in_trash: true });
    } catch {
      // Already gone, or the integration lost access; the row cleanup below
      // still matters more.
    }
  }
  if (!categoryIds.length) return;
  try {
    await db.from("destinations").delete().in("category_id", categoryIds);
    await db.from("categories").delete().in("id", categoryIds);
  } catch {
    // Leaves rows pointing at trashed pages. A Sync from Notion deactivates them.
  }
}

/** Parents first. validatePlan has already ruled out cycles and dangling parents. */
function topoSort(categories: PlannedCategory[]): PlannedCategory[] {
  const byKey = new Map(categories.map((c) => [c.key, c]));
  const out: PlannedCategory[] = [];
  const placed = new Set<string>();

  const place = (c: PlannedCategory) => {
    if (placed.has(c.key)) return;
    const parent = c.parentKey ? byKey.get(c.parentKey) : undefined;
    if (parent) place(parent);
    placed.add(c.key);
    out.push(c);
  };
  for (const c of categories) place(c);
  return out;
}
