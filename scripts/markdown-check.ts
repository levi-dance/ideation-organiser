/**
 * Fixture checks for the markdown → Notion blocks converter.
 * Run: npm run check:markdown
 */
import {
  markdownToBlocks,
  markdownToRichText,
  hasMarkdownStructure,
  stripMarkdown,
  chunkBlocks,
  type NotionBlock,
} from "../lib/notion/markdown";

let failures = 0;

function check(name: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    console.log(`  ok  ${name}`);
  } else {
    failures++;
    console.error(`FAIL  ${name}\n  expected: ${e}\n  actual:   ${a}`);
  }
}

function blockTypes(blocks: NotionBlock[]): string[] {
  return blocks.map((b) => Object.keys(b)[0]);
}

function plain(blocks: NotionBlock[], i: number): string {
  const content = Object.values(blocks[i])[0] as { rich_text: { text: { content: string } }[] };
  return content.rich_text.map((t) => t.text.content).join("");
}

// --- block parsing ---
const structured = markdownToBlocks(
  "# Big idea\n\nIntro line one.\nStill the intro.\n\n## Points\n- first\n- second\n1. step one\n2) step two\n> a quote"
);
check(
  "block types",
  blockTypes(structured),
  ["heading_1", "paragraph", "heading_2", "bulleted_list_item", "bulleted_list_item", "numbered_list_item", "numbered_list_item", "quote"]
);
check("heading text", plain(structured, 0), "Big idea");
check("paragraph joins wrapped lines", plain(structured, 1), "Intro line one.\nStill the intro.");
check("quote text", plain(structured, 7), "a quote");

check("plain prose stays one paragraph", blockTypes(markdownToBlocks("just a plain thought, nothing fancy")), ["paragraph"]);
check("unknown syntax renders literally", plain(markdownToBlocks("| a | table |"), 0), "| a | table |");
check("empty input", markdownToBlocks("").length, 0);
check("indented bullet flattens", blockTypes(markdownToBlocks("- top\n  - nested")), ["bulleted_list_item", "bulleted_list_item"]);

// --- inline parsing ---
check(
  "bold + italic + code runs",
  markdownToRichText("mix **bold** and *ital* and `code`").map((r) => [r.text.content, r.annotations ?? null]),
  [["mix ", null], ["bold", { bold: true }], [" and ", null], ["ital", { italic: true }], [" and ", null], ["code", { code: true }]]
);
check(
  "link",
  markdownToRichText("see [docs](https://x.co)").map((r) => [r.text.content, r.text.link?.url ?? null]),
  [["see ", null], ["docs", "https://x.co"]]
);
check("underscore italic", markdownToRichText("_soft_")[0].annotations, { italic: true });
check(
  "long text chunks at 2000",
  markdownToRichText("x".repeat(4100)).map((r) => r.text.content.length),
  [2000, 2000, 100]
);

// --- structure detection ---
check("detects bullets", hasMarkdownStructure("- one\n- two"), true);
check("detects heading", hasMarkdownStructure("## Points"), true);
check("detects bold", hasMarkdownStructure("this is **key**"), true);
check("plain prose is unstructured", hasMarkdownStructure("buy almond milk from the shop"), false);
check("asterisk without space is not a bullet", hasMarkdownStructure("*emphasis* only"), false);

// --- stripping ---
check(
  "strip flattens everything",
  stripMarkdown("# Title\n- **bold** point\n> quoted `code` [link](https://x.co)"),
  "Title bold point quoted code link"
);

// --- chunking ---
const many = markdownToBlocks(Array.from({ length: 250 }, (_, i) => `- item ${i}`).join("\n"));
check("chunkBlocks sizes", chunkBlocks(many).map((c) => c.length), [100, 100, 50]);

if (failures) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log("\nall markdown checks passed");
