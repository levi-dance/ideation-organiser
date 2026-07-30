/**
 * One-time seed: creates a starter Notion structure under NOTION_ROOT_PAGE_ID
 * and mirrors it into the Postgres taxonomy (categories + destinations).
 *
 * The taxonomy below is an EXAMPLE — edit the names, clients, and banks to
 * match your life before running. Only the catch-all's slug ("general-notes")
 * must stay: lib/pipeline/ingest.ts uses it as CATCH_ALL_SLUG. After seeding,
 * Notion is the source of truth — restructure there and run `npm run sync`.
 *
 * Run: npm run seed
 * Safe to re-run only on an empty database — it does not dedupe.
 */
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { Client } from "@notionhq/client";

config({ path: ".env.local" });
config();

const required = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "NOTION_API_KEY",
  "NOTION_ROOT_PAGE_ID",
];
for (const key of required) {
  if (!process.env[key]) {
    console.error(`Missing env var ${key} — copy .env.local.example to .env.local and fill it in.`);
    process.exit(1);
  }
}

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);
const notion = new Client({ auth: process.env.NOTION_API_KEY });
const ROOT = process.env.NOTION_ROOT_PAGE_ID!;

async function createPage(parentId: string, title: string): Promise<string> {
  const page = await notion.pages.create({
    parent: { type: "page_id", page_id: parentId },
    properties: { title: { title: [{ text: { content: title } }] } },
  });
  return page.id;
}

/** Creates a bank database and returns its DATA SOURCE id (what rows are created under). */
async function createBank(parentId: string, title: string): Promise<string> {
  const database = await notion.databases.create({
    parent: { type: "page_id", page_id: parentId },
    title: [{ text: { content: title } }],
    initial_data_source: {
      properties: {
        Title: { title: {} },
        Note: { rich_text: {} },
        Added: { date: {} },
        "Entry Log": { url: {} },
      },
    },
  });
  if (!("data_sources" in database) || !database.data_sources.length) {
    throw new Error(`Database ${title} created but no data source returned`);
  }
  return database.data_sources[0].id;
}

async function category(params: {
  slug: string;
  name: string;
  description: string;
  parentId?: string | null;
}): Promise<string> {
  const { data, error } = await db
    .from("categories")
    .insert({
      slug: params.slug,
      name: params.name,
      description: params.description,
      parent_category_id: params.parentId ?? null,
      is_seed: true,
    })
    .select("id")
    .single();
  if (error) throw new Error(`categories insert (${params.slug}): ${error.message}`);
  return data.id;
}

async function bankDestination(params: {
  categoryId: string;
  title: string;
  notionDatabaseId: string;
  dedup?: boolean;
}) {
  const { error } = await db.from("destinations").insert({
    category_id: params.categoryId,
    kind: "bank_database",
    notion_database_id: params.notionDatabaseId,
    title: params.title,
    dedup_enabled: params.dedup ?? false,
  });
  if (error) throw new Error(`destinations insert (${params.title}): ${error.message}`);
}

async function docDestination(params: {
  categoryId: string;
  title: string;
  notionPageId: string;
  isCurrentFocus?: boolean;
}) {
  const { error } = await db.from("destinations").insert({
    category_id: params.categoryId,
    kind: "document_section",
    notion_page_id: params.notionPageId,
    title: params.title,
    is_current_focus: params.isCurrentFocus ?? false,
  });
  if (error) throw new Error(`destinations insert (${params.title}): ${error.message}`);
}

async function main() {
  const { count } = await db.from("categories").select("*", { count: "exact", head: true });
  if (count && count > 0) {
    console.error(`Database already has ${count} categories — seed aborted (it does not dedupe).`);
    process.exit(1);
  }

  console.log("Creating Notion structure…");

  // Clients
  const clientsPage = await createPage(ROOT, "Clients");
  const clientsCat = await category({
    slug: "clients",
    name: "Clients",
    description:
      "Client work. Anything for a specific client — ideas, notes, meeting takeaways — belongs under that client, NOT under personal content ideas, even if it mentions a platform like Instagram or YouTube.",
  });

  for (const clientName of ["Acme Co", "Globex"]) {
    const slug = clientName.toLowerCase().replace(/\s+/g, "-");
    const clientPage = await createPage(clientsPage, clientName);
    const clientCat = await category({
      slug: `client-${slug}`,
      name: clientName,
      description: `Work for client "${clientName}": project ideas, content concepts for their channels, tasks, and notes.`,
      parentId: clientsCat,
    });
    const notesDb = await createBank(clientPage, "Project Notes");
    await bankDestination({
      categoryId: clientCat,
      title: `${clientName} — Project Notes`,
      notionDatabaseId: notesDb,
    });
    const meetingsDb = await createBank(clientPage, "Meeting Log");
    await bankDestination({
      categoryId: clientCat,
      title: `${clientName} — Meeting Log`,
      notionDatabaseId: meetingsDb,
    });
    console.log(`  ✓ Client: ${clientName}`);
  }

  // Writing — a long-form project with an idea bank and a live draft.
  const writingPage = await createPage(ROOT, "Writing");
  const writingCat = await category({
    slug: "writing",
    name: "Writing",
    description:
      "Long-form writing: article and essay thoughts, outlines, arguments, and the piece currently being drafted.",
  });
  const articleIdeasDb = await createBank(writingPage, "Article Ideas");
  await bankDestination({
    categoryId: writingCat,
    title: "Article Ideas",
    notionDatabaseId: articleIdeasDb,
  });
  const currentDraft = await createPage(writingPage, "Current Draft");
  await docDestination({
    categoryId: writingCat,
    title: "Current Draft",
    notionPageId: currentDraft,
    isCurrentFocus: true,
  });
  console.log("  ✓ Writing");

  // Books to Read
  const booksCat = await category({
    slug: "books-to-read",
    name: "Books to Read",
    description:
      "Books, articles, and podcasts to check out — recommendations with who mentioned them and why.",
  });
  const booksDb = await createBank(ROOT, "Books to Read");
  await bankDestination({
    categoryId: booksCat,
    title: "Books to Read",
    notionDatabaseId: booksDb,
    dedup: true,
  });
  console.log("  ✓ Books to Read");

  // Gear / Wishlist
  const gearCat = await category({
    slug: "gear-wishlist",
    name: "Gear / Wishlist",
    description:
      "Gear and equipment I want to buy — cameras, audio, tech, tools — with why I want it.",
  });
  const gearDb = await createBank(ROOT, "Gear / Wishlist");
  await bankDestination({
    categoryId: gearCat,
    title: "Gear / Wishlist",
    notionDatabaseId: gearDb,
    dedup: true,
  });
  console.log("  ✓ Gear / Wishlist");

  // Groceries
  const groceriesCat = await category({
    slug: "groceries",
    name: "Groceries",
    description:
      "Grocery and shopping list items. Entries are often several items in one capture — file each item separately.",
  });
  const groceriesDb = await createBank(ROOT, "Groceries");
  await bankDestination({
    categoryId: groceriesCat,
    title: "Groceries",
    notionDatabaseId: groceriesDb,
    dedup: true,
  });
  console.log("  ✓ Groceries");

  // Content Ideas (your own channels)
  const contentPage = await createPage(ROOT, "Content Ideas");
  const contentCat = await category({
    slug: "content-ideas",
    name: "Content Ideas",
    description:
      "MY OWN content creation (not client work): video and content ideas for my personal channels.",
  });
  const channels: [string, string, string][] = [
    ["content-ig-tiktok", "Instagram / TikTok", "Short-form video ideas for my own Instagram and TikTok."],
    ["content-youtube", "YouTube", "Long-form video ideas for my own YouTube channel."],
    ["content-newsletter", "Newsletter", "Ideas and topics for my own newsletter."],
  ];
  for (const [slug, name, description] of channels) {
    const cat = await category({ slug, name, description, parentId: contentCat });
    const dbId = await createBank(contentPage, name);
    await bankDestination({ categoryId: cat, title: `Content Ideas — ${name}`, notionDatabaseId: dbId });
  }
  console.log("  ✓ Content Ideas (Instagram/TikTok, YouTube, Newsletter)");

  // General Learnings / Notes — catch-all. Slug must match CATCH_ALL_SLUG in lib/pipeline/ingest.ts.
  const generalCat = await category({
    slug: "general-notes",
    name: "General Learnings / Notes",
    description:
      "Catch-all for learnings, thoughts, and notes that don't fit a more specific destination.",
  });
  const generalDb = await createBank(ROOT, "General Learnings / Notes");
  await bankDestination({
    categoryId: generalCat,
    title: "General Learnings / Notes",
    notionDatabaseId: generalDb,
  });
  console.log("  ✓ General Learnings / Notes (catch-all)");

  console.log("\nDone. The taxonomy is live — start capturing.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
