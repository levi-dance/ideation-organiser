// content_snippet is the "title + cleaned body" string shown in the entry log
// and split back into parts for reassign/backfill/synthesis. One separator,
// defined once here so the join and split can never drift.

const SEP = ": ";
const LEGACY_SEP = " — "; // older rows used an em dash; still recover them

/** Join a title and (already-cleaned) body into a content_snippet. */
export function formatSnippet(title: string, body: string): string {
  return body ? `${title}${SEP}${body}` : title;
}

/** Recover { title, body } from a content_snippet, accepting the current and legacy separators. */
export function splitSnippet(snippet: string): { title: string; body: string } {
  let i = snippet.indexOf(SEP);
  let len = SEP.length;
  if (i === -1) {
    i = snippet.indexOf(LEGACY_SEP);
    len = LEGACY_SEP.length;
  }
  if (i === -1) return { title: snippet, body: "" };
  return { title: snippet.slice(0, i), body: snippet.slice(i + len) };
}
