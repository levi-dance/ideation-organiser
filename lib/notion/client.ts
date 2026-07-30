import { Client } from "@notionhq/client";

let cached: Client | null = null;

export function notion(): Client {
  if (!cached) {
    cached = new Client({ auth: process.env.NOTION_API_KEY });
  }
  return cached;
}

/** Convert a Notion page/database id to a clickable URL. */
export function notionUrl(id: string): string {
  return `https://www.notion.so/${id.replace(/-/g, "")}`;
}
