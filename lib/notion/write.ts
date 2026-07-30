import { notion } from "./client";
import {
  chunkBlocks,
  hasMarkdownStructure,
  markdownToBlocks,
  markdownToRichText,
  stripMarkdown,
  type NotionBlock,
  type RichText,
} from "./markdown";
import type { DestinationWithCategory } from "@/lib/types";

export type NotionWriteResult = {
  notionPageId: string | null;
  notionBlockIds: string[];
  warning: string | null;
};

type BankSchema = {
  titleProp: string;
  noteProp: string | null; // a rich_text property, if the data source has exactly one
  dateProp: string | null; // "Added"-style date property, if present
  urlProp: string | null; // "Entry Log"-style url property, if present
};

// User-created databases have arbitrary properties ("Name" instead of "Title",
// no Added/Entry Log). Fetch each data source's schema once and adapt.
const schemaCache = new Map<string, BankSchema>();

async function bankSchema(dataSourceId: string): Promise<BankSchema> {
  const cached = schemaCache.get(dataSourceId);
  if (cached) return cached;

  const ds = await notion().dataSources.retrieve({ data_source_id: dataSourceId });
  if (!("properties" in ds)) {
    throw new Error(`Could not read schema for data source ${dataSourceId}`);
  }
  const entries = Object.entries(ds.properties);
  const titleProp = entries.find(([, p]) => p.type === "title")?.[0];
  if (!titleProp) throw new Error(`Data source ${dataSourceId} has no title property`);

  const richTextProps = entries.filter(([, p]) => p.type === "rich_text").map(([name]) => name);
  const dateProps = entries.filter(([, p]) => p.type === "date").map(([name]) => name);
  const urlProps = entries.filter(([, p]) => p.type === "url").map(([name]) => name);

  const schema: BankSchema = {
    titleProp,
    noteProp:
      richTextProps.find((n) => n.toLowerCase() === "note") ??
      (richTextProps.length === 1 ? richTextProps[0] : null),
    dateProp: dateProps.find((n) => n.toLowerCase() === "added") ?? null,
    urlProp: urlProps.find((n) => n.toLowerCase() === "entry log") ?? null,
  };
  schemaCache.set(dataSourceId, schema);
  return schema;
}

/** Bodies longer than this get the full content in the page body, not just the Note prop. */
const NOTE_SUMMARY_LENGTH = 200;

type AppendChildren = Parameters<
  ReturnType<typeof notion>["blocks"]["children"]["append"]
>[0]["children"];

/** Development prompts render as orange italic parentheticals after the body. */
function promptBlocks(prompts: string[]): NotionBlock[] {
  return prompts.map((p) => ({
    paragraph: {
      rich_text: [
        {
          type: "text" as const,
          text: { content: `(${p.slice(0, MAX_PROMPT_LENGTH)})` },
          annotations: { italic: true, color: "orange" },
        },
      ],
    },
  }));
}
const MAX_PROMPT_LENGTH = 1998; // leave room for the parentheses within Notion's 2000 cap

/**
 * File formatted content into a destination. `body` may be lightweight Markdown;
 * structured bodies become real Notion blocks.
 * - bank_database: create a row (page) in the database's data source.
 *   (`notion_database_id` stores the DATA SOURCE id — Notion API 2025-09 model.)
 *   The Note property keeps a short plain-text summary so table views stay scannable;
 *   structured or long bodies land in the row's page body as blocks.
 * - document_section: append blocks after the configured section heading.
 */
export async function writeToDestination(
  dest: DestinationWithCategory,
  title: string,
  body: string,
  entryUrl: string,
  developmentPrompts: string[] = []
): Promise<NotionWriteResult> {
  if (dest.kind === "bank_database") {
    if (!dest.notion_database_id) {
      throw new Error(`Destination ${dest.title} has no notion_database_id`);
    }
    const schema = await bankSchema(dest.notion_database_id);
    const properties: Record<string, unknown> = {
      [schema.titleProp]: { title: [{ text: { content: title.slice(0, 200) } }] },
    };
    if (schema.noteProp && body) {
      properties[schema.noteProp] = {
        rich_text: [{ text: { content: stripMarkdown(body).slice(0, NOTE_SUMMARY_LENGTH) } }],
      };
    }
    if (schema.dateProp) {
      properties[schema.dateProp] = { date: { start: new Date().toISOString() } };
    }
    if (schema.urlProp) {
      properties[schema.urlProp] = { url: entryUrl };
    }

    // Page body: full structured content when the body earns it (or has nowhere
    // else to go), plus any development prompts. Short plain bodies stay in the
    // Note property only, so grocery-style rows keep empty pages.
    const wantsPageBody =
      !!body &&
      (!schema.noteProp || hasMarkdownStructure(body) || body.length > NOTE_SUMMARY_LENGTH);
    const children: NotionBlock[] = [
      ...(wantsPageBody ? markdownToBlocks(body) : []),
      ...promptBlocks(developmentPrompts),
    ];
    const chunks = chunkBlocks(children);

    const page = await notion().pages.create({
      parent: { type: "data_source_id", data_source_id: dest.notion_database_id },
      properties: properties as Parameters<
        ReturnType<typeof notion>["pages"]["create"]
      >[0]["properties"],
      ...(chunks.length ? { children: chunks[0] as unknown as AppendChildren } : {}),
    });
    for (const chunk of chunks.slice(1)) {
      await notion().blocks.children.append({
        block_id: page.id,
        children: chunk as unknown as AppendChildren,
      });
    }
    return { notionPageId: page.id, notionBlockIds: [], warning: null };
  }

  // document_section
  if (!dest.notion_page_id) {
    throw new Error(`Destination ${dest.title} has no notion_page_id`);
  }

  // When a section heading is configured, insert at the bottom of that section
  // rather than the bottom of the page.
  let after: string | undefined;
  let warning: string | null = null;
  if (dest.notion_section_heading) {
    const anchor = await findSectionAnchor(dest.notion_page_id, dest.notion_section_heading);
    if (anchor) {
      after = anchor;
    } else {
      warning = `Heading "${dest.notion_section_heading}" not found — appended at end of page`;
    }
  }

  const boldTitle: RichText = {
    type: "text",
    text: { content: title.slice(0, 200) },
    annotations: { bold: true },
  };
  const children: NotionBlock[] = [];
  if (body && hasMarkdownStructure(body)) {
    children.push({ paragraph: { rich_text: [boldTitle] } });
    children.push(...markdownToBlocks(body));
  } else {
    const richText: RichText[] = [boldTitle];
    if (body) richText.push(...markdownToRichText(` — ${body}`));
    children.push({ paragraph: { rich_text: richText } });
  }
  children.push(...promptBlocks(developmentPrompts));

  // One append inserts the whole array in order after the anchor; chunks beyond
  // Notion's 100-block cap continue after the previous chunk's last block.
  const blockIds: string[] = [];
  let anchor = after;
  for (const chunk of chunkBlocks(children)) {
    const res = await notion().blocks.children.append({
      block_id: dest.notion_page_id,
      ...(anchor ? { after: anchor } : {}),
      children: chunk as unknown as AppendChildren,
    });
    const ids = res.results.map((b) => b.id);
    blockIds.push(...ids);
    anchor = ids[ids.length - 1] ?? anchor;
  }
  return { notionPageId: dest.notion_page_id, notionBlockIds: blockIds, warning };
}

const HEADING_LEVEL: Record<string, number> = { heading_1: 1, heading_2: 2, heading_3: 3 };

/**
 * Find the block id after which new content should be inserted so it lands at
 * the bottom of the named section: the last block before the next heading of
 * the same or higher level. Returns null if the heading isn't on the page.
 */
async function findSectionAnchor(pageId: string, headingText: string): Promise<string | null> {
  const wanted = headingText.trim().toLowerCase();
  const blocks: { id: string; type: string; text: string }[] = [];
  let cursor: string | undefined;
  do {
    const res = await notion().blocks.children.list({
      block_id: pageId,
      page_size: 100,
      start_cursor: cursor,
    });
    for (const b of res.results) {
      if (!("type" in b)) continue;
      let text = "";
      const block = b as unknown as Record<string, { rich_text?: { plain_text: string }[] }>;
      const content = block[b.type];
      if (content?.rich_text) text = content.rich_text.map((t) => t.plain_text).join("");
      blocks.push({ id: b.id, type: b.type, text });
    }
    cursor = res.has_more ? (res.next_cursor ?? undefined) : undefined;
  } while (cursor);

  const start = blocks.findIndex(
    (b) => HEADING_LEVEL[b.type] && b.text.trim().toLowerCase() === wanted
  );
  if (start === -1) return null;

  const level = HEADING_LEVEL[blocks[start].type];
  let anchor = blocks[start].id;
  for (let i = start + 1; i < blocks.length; i++) {
    const blockLevel = HEADING_LEVEL[blocks[i].type];
    if (blockLevel && blockLevel <= level) break; // next section starts
    anchor = blocks[i].id;
  }
  return anchor;
}

/**
 * Create a new bank database under a parent page and return its data source id
 * (what `pages.create` needs as a parent). Used by seed + dynamic creation.
 */
export async function createBankDatabase(parentPageId: string, title: string): Promise<string> {
  const db = await notion().databases.create({
    parent: { type: "page_id", page_id: parentPageId },
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
  if (!("data_sources" in db) || !db.data_sources.length) {
    throw new Error(`Database ${title} was created but returned no data source id`);
  }
  return db.data_sources[0].id;
}

/** Create a plain container page under a parent page. */
export async function createContainerPage(parentPageId: string, title: string): Promise<string> {
  const page = await notion().pages.create({
    parent: { type: "page_id", page_id: parentPageId },
    properties: { title: { title: [{ text: { content: title } }] } },
  });
  return page.id;
}
