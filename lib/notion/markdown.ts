/**
 * Minimal Markdown → Notion blocks converter for classifier-emitted bodies.
 *
 * The classifier is prompted to emit only this grammar: #/##/### headings,
 * "-" bullets, "1." numbered lists, "> " quotes, **bold**, *italic*, `code`,
 * [text](url). Anything else renders literally as a paragraph - never throws.
 * Nested lists flatten; tables/images/code fences are not supported.
 */

export type RichText = {
  type: "text";
  text: { content: string; link?: { url: string } };
  annotations?: { bold?: boolean; italic?: boolean; code?: boolean; color?: string };
};

type BlockContent = { rich_text: RichText[] };

export type NotionBlock =
  | { paragraph: BlockContent }
  | { heading_1: BlockContent }
  | { heading_2: BlockContent }
  | { heading_3: BlockContent }
  | { bulleted_list_item: BlockContent }
  | { numbered_list_item: BlockContent }
  | { quote: BlockContent };

/** Notion caps a single rich_text item's content at 2000 chars. */
const MAX_TEXT_LENGTH = 2000;

/** Notion caps a single children array at 100 blocks. */
const MAX_BLOCKS_PER_APPEND = 100;

function pushText(
  out: RichText[],
  content: string,
  annotations?: RichText["annotations"],
  link?: { url: string }
): void {
  for (let i = 0; i < content.length; i += MAX_TEXT_LENGTH) {
    const item: RichText = { type: "text", text: { content: content.slice(i, i + MAX_TEXT_LENGTH) } };
    if (link) item.text.link = link;
    if (annotations) item.annotations = annotations;
    out.push(item);
  }
}

const INLINE_PATTERN = /\*\*(.+?)\*\*|\*([^*\n]+)\*|_([^_\n]+)_|`([^`\n]+)`|\[([^\]\n]+)\]\(([^)\s]+)\)/g;

/** Parse inline markdown (**bold**, *italic*, `code`, [text](url)) into rich_text. */
export function markdownToRichText(text: string): RichText[] {
  const out: RichText[] = [];
  let last = 0;
  INLINE_PATTERN.lastIndex = 0;
  for (let m = INLINE_PATTERN.exec(text); m; m = INLINE_PATTERN.exec(text)) {
    if (m.index > last) pushText(out, text.slice(last, m.index));
    const [, bold, italic, underscore, code, linkText, linkUrl] = m;
    if (bold !== undefined) pushText(out, bold, { bold: true });
    else if (italic !== undefined) pushText(out, italic, { italic: true });
    else if (underscore !== undefined) pushText(out, underscore, { italic: true });
    else if (code !== undefined) pushText(out, code, { code: true });
    else if (linkText !== undefined) pushText(out, linkText, undefined, { url: linkUrl });
    last = m.index + m[0].length;
  }
  if (last < text.length) pushText(out, text.slice(last));
  return out;
}

const HEADING_KEYS = ["heading_1", "heading_2", "heading_3"] as const;

/** Parse block-level markdown into Notion block objects. Line-based; never throws. */
export function markdownToBlocks(md: string): NotionBlock[] {
  const blocks: NotionBlock[] = [];
  let paragraphLines: string[] = [];
  const flush = () => {
    if (!paragraphLines.length) return;
    blocks.push({ paragraph: { rich_text: markdownToRichText(paragraphLines.join("\n")) } });
    paragraphLines = [];
  };

  for (const raw of md.split("\n")) {
    const line = raw.trim();
    if (!line) {
      flush();
      continue;
    }
    let m: RegExpMatchArray | null;
    if ((m = line.match(/^(#{1,3})\s+(.*)$/))) {
      flush();
      const key = HEADING_KEYS[m[1].length - 1];
      blocks.push({ [key]: { rich_text: markdownToRichText(m[2]) } } as NotionBlock);
    } else if ((m = line.match(/^[-*]\s+(.*)$/))) {
      flush();
      blocks.push({ bulleted_list_item: { rich_text: markdownToRichText(m[1]) } });
    } else if ((m = line.match(/^\d+[.)]\s+(.*)$/))) {
      flush();
      blocks.push({ numbered_list_item: { rich_text: markdownToRichText(m[1]) } });
    } else if ((m = line.match(/^>\s?(.*)$/))) {
      flush();
      blocks.push({ quote: { rich_text: markdownToRichText(m[1]) } });
    } else {
      paragraphLines.push(line);
    }
  }
  flush();
  return blocks;
}

/** True if the text has real block structure or bold - i.e. earns a structured page body. */
export function hasMarkdownStructure(text: string): boolean {
  return /^\s{0,3}(#{1,3}|[-*]|\d+[.)]|>)\s/m.test(text) || text.includes("**");
}

/** Flatten markdown to plain prose (for Note property summaries and snippets). */
export function stripMarkdown(md: string): string {
  return md
    .split("\n")
    .map((line) => line.replace(/^\s*(#{1,3}|>|[-*]|\d+[.)])\s+/, ""))
    .join(" ")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/\*([^*\n]+)\*/g, "$1")
    .replace(/_([^_\n]+)_/g, "$1")
    .replace(/`([^`\n]+)`/g, "$1")
    .replace(/\[([^\]\n]+)\]\([^)]*\)/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

/** Split into chunks Notion accepts per create/append call. */
export function chunkBlocks(blocks: NotionBlock[], size = MAX_BLOCKS_PER_APPEND): NotionBlock[][] {
  const chunks: NotionBlock[][] = [];
  for (let i = 0; i < blocks.length; i += size) chunks.push(blocks.slice(i, i + size));
  return chunks;
}
