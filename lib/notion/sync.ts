/**
 * Sync-from-Notion: scan everything the integration can see under the root
 * page and reconcile the Postgres taxonomy with it, so the owner can restructure
 * the second brain directly in Notion and the app keeps up.
 *
 * Rules:
 * - Every database (data source) => bank destination.
 * - Every plain page that contains other pages/databases => category (container).
 * - Every plain page with no children => document destination (e.g. a live draft).
 * - Pages that are ROWS of a database are content, not structure — ignored.
 * - Existing destinations keep their category and settings; only titles and
 *   active-state are updated. New nodes are created; vanished ones deactivated.
 * - New categories get a concise LLM-written routing description.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { notion } from "./client";
import { describeCategories } from "@/lib/claude/describe";

type Node = {
  id: string;
  object: "page" | "data_source";
  title: string;
  parentPageId: string | null; // null = root or workspace or unknown
  databaseId: string | null; // the owning database, for data sources — used for Notion links
};

// App-written output pages (and everything under them) are not taxonomy.
// Without this, the weekly synthesis container would become a category and
// every "Week of …" page a document destination the classifier files into.
const SYNC_IGNORE_TITLES = new Set(["weekly synthesis"]);

export type SyncReport = {
  scanned: number;
  createdCategories: string[];
  createdDestinations: string[];
  renamed: string[];
  reactivated: string[];
  deactivated: string[];
};

function plainTitle(rich: { plain_text: string }[] | undefined): string {
  return (rich ?? []).map((t) => t.plain_text).join("").trim() || "(untitled)";
}

function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "untitled"
  );
}

async function scanNotion(rootId: string): Promise<Node[]> {
  const nodes: Node[] = [];
  let cursor: string | undefined;
  const normalize = (id: string) => id.replace(/-/g, "");
  const root = normalize(rootId);

  do {
    const res = await notion().search({ page_size: 100, start_cursor: cursor });
    for (const item of res.results) {
      if (item.object === "page") {
        if (!("properties" in item) || item.in_trash) continue;
        const parent = item.parent;
        // Rows in databases are content, not structure.
        if (parent.type === "database_id" || parent.type === "data_source_id") continue;
        if (normalize(item.id) === root) continue;
        const titleProp = Object.values(item.properties).find((p) => p.type === "title");
        nodes.push({
          id: item.id,
          object: "page",
          title: plainTitle(titleProp?.type === "title" ? titleProp.title : []),
          parentPageId: parent.type === "page_id" ? parent.page_id : null,
          databaseId: null,
        });
      } else if (item.object === "data_source") {
        if (!("title" in item) || item.in_trash) continue;
        const dbParent = item.database_parent;
        nodes.push({
          id: item.id,
          object: "data_source",
          title: plainTitle(item.title),
          parentPageId: dbParent.type === "page_id" ? dbParent.page_id : null,
          databaseId: item.parent.type === "database_id" ? item.parent.database_id : null,
        });
      }
    }
    cursor = res.has_more ? (res.next_cursor ?? undefined) : undefined;
  } while (cursor);

  return nodes;
}

export async function runNotionSync(): Promise<SyncReport> {
  const rootId = process.env.NOTION_ROOT_PAGE_ID!;
  const db: SupabaseClient = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );

  const report: SyncReport = {
    scanned: 0,
    createdCategories: [],
    createdDestinations: [],
    renamed: [],
    reactivated: [],
    deactivated: [],
  };

  const normalize = (id: string) => id.replace(/-/g, "");
  const scannedNodes = await scanNotion(rootId);
  const scannedById = new Map(scannedNodes.map((n) => [normalize(n.id), n]));
  const isIgnored = (node: Node): boolean => {
    let cursor: Node | undefined = node;
    while (cursor) {
      if (SYNC_IGNORE_TITLES.has(cursor.title.trim().toLowerCase())) return true;
      cursor = cursor.parentPageId ? scannedById.get(normalize(cursor.parentPageId)) : undefined;
    }
    return false;
  };
  const nodes = scannedNodes.filter((n) => !isIgnored(n));
  report.scanned = nodes.length;

  const root = normalize(rootId);
  const byId = new Map(nodes.map((n) => [normalize(n.id), n]));
  const parentIds = new Set(
    nodes.map((n) => (n.parentPageId ? normalize(n.parentPageId) : root))
  );
  const isContainer = (n: Node) => n.object === "page" && parentIds.has(normalize(n.id));

  const { data: catRows } = await db.from("categories").select("*");
  const { data: destRows } = await db.from("destinations").select("*");
  const cats = catRows ?? [];
  const dests = destRows ?? [];

  const catByPageId = new Map(
    cats.filter((c) => c.notion_page_id).map((c) => [normalize(c.notion_page_id), c])
  );
  const catByName = new Map(cats.map((c) => [c.name.toLowerCase(), c]));
  const usedSlugs = new Set(cats.map((c) => c.slug));

  const newCategoryIds: string[] = [];

  async function ensureCategory(params: {
    name: string;
    notionPageId: string | null;
    parentCategoryId: string | null;
  }): Promise<string> {
    const pageKey = params.notionPageId ? normalize(params.notionPageId) : null;
    let existing = pageKey ? catByPageId.get(pageKey) : undefined;
    if (!existing) {
      existing = catByName.get(params.name.toLowerCase());
      // Backfill the page id onto a name-matched category.
      if (existing && pageKey && !existing.notion_page_id) {
        await db.from("categories").update({ notion_page_id: params.notionPageId }).eq("id", existing.id);
        existing.notion_page_id = params.notionPageId;
        catByPageId.set(pageKey, existing);
      }
    }
    if (existing) {
      const updates: Record<string, unknown> = {};
      if (existing.name !== params.name) {
        updates.name = params.name;
        report.renamed.push(`category: ${existing.name} → ${params.name}`);
      }
      if (!existing.is_active) {
        updates.is_active = true;
        report.reactivated.push(`category: ${params.name}`);
      }
      if (Object.keys(updates).length) {
        await db.from("categories").update(updates).eq("id", existing.id);
        Object.assign(existing, updates);
        catByName.set(params.name.toLowerCase(), existing);
      }
      return existing.id;
    }

    let slug = slugify(params.name);
    while (usedSlugs.has(slug)) slug = `${slug}-${Math.random().toString(36).slice(2, 6)}`;
    usedSlugs.add(slug);
    const { data: created, error } = await db
      .from("categories")
      .insert({
        slug,
        name: params.name,
        description: `Notes and items related to "${params.name}".`,
        parent_category_id: params.parentCategoryId,
        notion_page_id: params.notionPageId,
        created_by: "user",
      })
      .select()
      .single();
    if (error || !created) throw new Error(`category insert (${params.name}): ${error?.message}`);
    cats.push(created);
    if (pageKey) catByPageId.set(pageKey, created);
    catByName.set(params.name.toLowerCase(), created);
    report.createdCategories.push(params.name);
    newCategoryIds.push(created.id);
    return created.id;
  }

  /** Category for a node's parent chain; creates container categories top-down. */
  async function categoryForParent(node: Node): Promise<string | null> {
    const chain: Node[] = [];
    let cursor = node.parentPageId ? byId.get(normalize(node.parentPageId)) : undefined;
    while (cursor) {
      chain.unshift(cursor);
      cursor = cursor.parentPageId ? byId.get(normalize(cursor.parentPageId)) : undefined;
    }
    let parentCategoryId: string | null = null;
    for (const container of chain) {
      parentCategoryId = await ensureCategory({
        name: container.title,
        notionPageId: container.id,
        parentCategoryId,
      });
    }
    return parentCategoryId;
  }

  // Reconcile destinations.
  const destByNotionId = new Map<string, (typeof dests)[number]>();
  for (const d of dests) {
    if (d.notion_database_id) destByNotionId.set(normalize(d.notion_database_id), d);
    if (d.notion_page_id) destByNotionId.set(normalize(d.notion_page_id), d);
  }
  const seenDestIds = new Set<string>();

  for (const node of nodes) {
    if (isContainer(node)) continue; // containers become categories via chains

    const existing = destByNotionId.get(normalize(node.id));
    if (existing) {
      seenDestIds.add(existing.id);
      const updates: Record<string, unknown> = {};
      if (existing.title !== node.title) {
        updates.title = node.title;
        report.renamed.push(`destination: ${existing.title} → ${node.title}`);
      }
      // Banks store their owning database id in notion_page_id (used for
      // "open in Notion" links) — backfill it for rows created before this.
      if (node.object === "data_source" && node.databaseId && !existing.notion_page_id) {
        updates.notion_page_id = node.databaseId;
      }
      if (!existing.is_active) {
        updates.is_active = true;
        report.reactivated.push(`destination: ${node.title}`);
      }
      if (Object.keys(updates).length) {
        await db.from("destinations").update(updates).eq("id", existing.id);
      }
      continue;
    }

    // New destination discovered in Notion.
    let categoryId = await categoryForParent(node);
    if (!categoryId) {
      // Sits directly under the root: give it a category of its own name.
      categoryId = await ensureCategory({
        name: node.title,
        notionPageId: node.object === "page" ? node.id : null,
        parentCategoryId: null,
      });
    }
    const { data: created, error } = await db
      .from("destinations")
      .insert({
        category_id: categoryId,
        kind: node.object === "data_source" ? "bank_database" : "document_section",
        notion_database_id: node.object === "data_source" ? node.id : null,
        // For banks this is the owning database id (for links); for docs, the page.
        notion_page_id: node.object === "page" ? node.id : node.databaseId,
        title: node.title,
        created_by: "user",
      })
      .select()
      .single();
    if (error || !created) throw new Error(`destination insert (${node.title}): ${error?.message}`);
    seenDestIds.add(created.id);
    report.createdDestinations.push(node.title);
  }

  // Deactivate destinations whose Notion object vanished.
  for (const d of dests) {
    if (!d.is_active || seenDestIds.has(d.id)) continue;
    await db.from("destinations").update({ is_active: false }).eq("id", d.id);
    report.deactivated.push(`destination: ${d.title}`);
  }

  // Deactivate synced categories whose page vanished and that have no active destinations.
  const seenPageIds = new Set(nodes.map((n) => normalize(n.id)));
  for (const c of cats) {
    if (!c.is_active || !c.notion_page_id || seenPageIds.has(normalize(c.notion_page_id))) continue;
    const { count } = await db
      .from("destinations")
      .select("*", { count: "exact", head: true })
      .eq("category_id", c.id)
      .eq("is_active", true);
    if (!count) {
      await db.from("categories").update({ is_active: false }).eq("id", c.id);
      report.deactivated.push(`category: ${c.name}`);
    }
  }

  // Give brand-new categories proper routing descriptions (one cheap LLM call).
  if (newCategoryIds.length) {
    const catById = new Map(cats.map((c) => [c.id, c]));
    const described = await describeCategories(
      newCategoryIds
        .map((id) => catById.get(id))
        .filter((c) => c !== undefined)
        .map((c) => ({
          id: c.id,
          name: c.name,
          parentName: c.parent_category_id
            ? (catById.get(c.parent_category_id)?.name ?? null)
            : null,
        }))
    );
    for (const d of described) {
      await db.from("categories").update({ description: d.description }).eq("id", d.id);
    }
  }

  return report;
}
