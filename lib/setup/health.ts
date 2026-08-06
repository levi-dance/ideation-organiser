/**
 * Setup health check: probe every dependency the app needs and, for each
 * failure, say the exact thing to go and do.
 *
 * The reason this exists: a missing table, a revoked token, or a root page that
 * was never shared with the Notion integration all surface today as a raw API
 * error in the middle of a capture, or as nothing at all. Each check below owns
 * the remedy for its own failure so nobody has to interpret a stack trace.
 */
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { notion } from "@/lib/notion/client";
import { clickupTokenConfigured, getTeams } from "@/lib/clickup/client";
import { embedTexts, EMBEDDING_MODEL } from "@/lib/embeddings/voyage";
import { CATCH_ALL_SLUG } from "@/lib/setup/build-taxonomy";
import Anthropic from "@anthropic-ai/sdk";

export type CheckStatus = "ok" | "warn" | "fail" | "skipped";

export type HealthCheck = {
  id: string;
  label: string;
  status: CheckStatus;
  /** What was actually found. */
  detail: string;
  /** Exactly what to do about it, when there is something to do. */
  remedy: string | null;
};

export type HealthReport = {
  checks: HealthCheck[];
  /** True when nothing is failing, so capture will work. */
  ready: boolean;
  checkedAt: string;
};

/** Every table supabase/schema.sql creates. A missing one means a partial apply. */
const TABLES = [
  "categories",
  "destinations",
  "entries",
  "entry_destinations",
  "classification_runs",
  "undo_log",
  "job_queue",
  "entry_embeddings",
  "work_lists",
  "clickup_actions",
  "work_routing_queue",
  "ai_instructions",
];

const SCHEMA_REMEDY =
  "Open your Supabase project, go to SQL Editor, paste the whole of supabase/schema.sql from the repo, and click Run. It is safe to run again on a database that is already partly set up.";

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function statusOf(e: unknown): number | null {
  const status = (e as { status?: number })?.status;
  return typeof status === "number" ? status : null;
}

function envCheck(): HealthCheck {
  const required = [
    "NEXT_PUBLIC_SUPABASE_URL",
    "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    "SUPABASE_SERVICE_ROLE_KEY",
    "NOTION_API_KEY",
    "NOTION_ROOT_PAGE_ID",
    "ANTHROPIC_API_KEY",
  ];
  const missing = required.filter((key) => !process.env[key]?.trim());
  if (missing.length) {
    return {
      id: "env",
      label: "Required settings",
      status: "fail",
      detail: `Not set: ${missing.join(", ")}.`,
      remedy:
        "Add them in Vercel under Project, Settings, Environment Variables, then redeploy. Running on your own machine instead? Put them in .env.local and restart. The README's env var table says what each one is.",
    };
  }
  return {
    id: "env",
    label: "Required settings",
    status: "ok",
    detail: "Every required key is set.",
    remedy: null,
  };
}

async function schemaCheck(): Promise<HealthCheck> {
  const db = createSupabaseAdminClient();
  const missing: string[] = [];
  const failed: string[] = [];

  await Promise.all(
    TABLES.map(async (table) => {
      const { error } = await db.from(table).select("*", { count: "exact", head: true });
      if (!error) return;
      if (/does not exist|schema cache|Could not find/i.test(error.message)) missing.push(table);
      else failed.push(`${table} (${error.message})`);
    })
  );

  if (missing.length) {
    return {
      id: "schema",
      label: "Database tables",
      status: "fail",
      detail: `${missing.length} of ${TABLES.length} tables are missing: ${missing.join(", ")}.`,
      remedy: SCHEMA_REMEDY,
    };
  }
  if (failed.length) {
    return {
      id: "schema",
      label: "Database tables",
      status: "fail",
      detail: `Could not read: ${failed.join("; ")}.`,
      remedy:
        "The tables exist but something rejected the read. Check that SUPABASE_SERVICE_ROLE_KEY is the service_role key from Supabase Settings, API, and not the anon key.",
    };
  }
  return {
    id: "schema",
    label: "Database tables",
    status: "ok",
    detail: `All ${TABLES.length} tables are present.`,
    remedy: null,
  };
}

async function notionTokenCheck(): Promise<HealthCheck> {
  if (!process.env.NOTION_API_KEY?.trim()) {
    return {
      id: "notion-token",
      label: "Notion connection",
      status: "fail",
      detail: "NOTION_API_KEY is not set.",
      remedy:
        "Create an internal integration at notion.so/my-integrations, copy its Internal Integration Secret, and set it as NOTION_API_KEY.",
    };
  }
  try {
    const me = await notion().users.me({});
    const name = "name" in me && me.name ? me.name : "your integration";
    return {
      id: "notion-token",
      label: "Notion connection",
      status: "ok",
      detail: `Connected as ${name}.`,
      remedy: null,
    };
  } catch (e) {
    const code = statusOf(e);
    return {
      id: "notion-token",
      label: "Notion connection",
      status: "fail",
      detail:
        code === 401
          ? "Notion rejected the token."
          : `Notion could not be reached: ${message(e)}`,
      remedy:
        "Go to notion.so/my-integrations, open your integration, and copy the Internal Integration Secret again into NOTION_API_KEY. A secret that was regenerated or an integration that was deleted both look like this.",
    };
  }
}

async function notionRootCheck(): Promise<HealthCheck> {
  const raw = process.env.NOTION_ROOT_PAGE_ID?.trim();
  if (!raw) {
    return {
      id: "notion-root",
      label: "Notion root page",
      status: "fail",
      detail: "NOTION_ROOT_PAGE_ID is not set.",
      remedy:
        "Make an empty page in Notion to hold your second brain, open it, and copy the 32 character code at the end of its URL into NOTION_ROOT_PAGE_ID.",
    };
  }
  if (!/^[0-9a-f]{32}$/i.test(raw.replace(/-/g, ""))) {
    return {
      id: "notion-root",
      label: "Notion root page",
      status: "fail",
      detail: `"${raw}" is not a Notion page id.`,
      remedy:
        "A page id is 32 letters and numbers, optionally with hyphens. Open the page in Notion and take the code at the very end of the URL, after the last hyphen and before any question mark.",
    };
  }

  try {
    const page = await notion().pages.retrieve({ page_id: raw });
    let title = "";
    if ("properties" in page) {
      const titleProp = Object.values(page.properties).find((p) => p.type === "title");
      if (titleProp?.type === "title") {
        title = titleProp.title.map((t) => t.plain_text).join("").trim();
      }
    }
    const inTrash = "in_trash" in page && page.in_trash;
    if (inTrash) {
      return {
        id: "notion-root",
        label: "Notion root page",
        status: "fail",
        detail: `"${title || "The root page"}" is in Notion's trash.`,
        remedy:
          "Restore the page in Notion, or make a new empty page, share it with your integration, and put its id in NOTION_ROOT_PAGE_ID.",
      };
    }
    return {
      id: "notion-root",
      label: "Notion root page",
      status: "ok",
      detail: `Reachable and shared: "${title || "(untitled)"}".`,
      remedy: null,
    };
  } catch (e) {
    const code = statusOf(e);
    // The one that catches everybody. Notion answers 404 for a page that exists
    // but has not been shared with the integration, which reads as a wrong page
    // id when the real cause is the skipped Connections step.
    if (code === 404) {
      return {
        id: "notion-root",
        label: "Notion root page",
        status: "fail",
        detail: "Notion says this page does not exist, which means one of two things.",
        remedy:
          "Almost always: the page has not been shared with your integration. Open the page in Notion, click the ... menu at the top right, choose Connections, and pick your integration. Notion returns exactly this error for a page it can see but you have not been given access to. If it is already connected, then the id in NOTION_ROOT_PAGE_ID belongs to a different page: recopy the 32 character code from the end of the page's URL.",
      };
    }
    // A rejected token fails this check too, and telling someone to re-share
    // the page would send them after the wrong problem.
    if (code === 401) {
      return {
        id: "notion-root",
        label: "Notion root page",
        status: "fail",
        detail: "Could not be checked, because Notion rejected the token.",
        remedy: "Fix the Notion connection above first, then check again.",
      };
    }
    return {
      id: "notion-root",
      label: "Notion root page",
      status: "fail",
      detail: `Notion returned an error: ${message(e)}`,
      remedy:
        "Check NOTION_ROOT_PAGE_ID against the page URL, and that the page is shared with your integration through the ... menu, Connections.",
    };
  }
}

async function anthropicCheck(): Promise<HealthCheck> {
  const model = process.env.ANTHROPIC_MODEL || "claude-haiku-4-5";
  if (!process.env.ANTHROPIC_API_KEY?.trim()) {
    return {
      id: "anthropic",
      label: "Claude (the filing brain)",
      status: "fail",
      detail: "ANTHROPIC_API_KEY is not set.",
      remedy:
        "Create a key at console.anthropic.com under API Keys and set it as ANTHROPIC_API_KEY. The account needs credit on it: a new key with a zero balance fails on the first capture.",
    };
  }
  try {
    await new Anthropic().models.retrieve(model);
    return {
      id: "anthropic",
      label: "Claude (the filing brain)",
      status: "ok",
      detail: `Key works, and ${model} is available to it.`,
      remedy: null,
    };
  } catch (e) {
    const code = statusOf(e);
    if (code === 404) {
      return {
        id: "anthropic",
        label: "Claude (the filing brain)",
        status: "fail",
        detail: `Your key works, but there is no model called "${model}".`,
        remedy:
          "Clear ANTHROPIC_MODEL to fall back to the default, claude-haiku-4-5, or set it to a model id listed at console.anthropic.com.",
      };
    }
    return {
      id: "anthropic",
      label: "Claude (the filing brain)",
      status: "fail",
      detail: code === 401 ? "Anthropic rejected the key." : `Anthropic call failed: ${message(e)}`,
      remedy:
        "Copy the key again from console.anthropic.com, API Keys, into ANTHROPIC_API_KEY, and check the account has credit under Billing.",
    };
  }
}

async function voyageCheck(): Promise<HealthCheck> {
  if (!process.env.VOYAGE_API_KEY?.trim()) {
    return {
      id: "voyage",
      label: "Search embeddings (Voyage)",
      status: "warn",
      detail: "VOYAGE_API_KEY is not set, so Ask your brain has nothing to search.",
      remedy:
        "Create a free key at dash.voyageai.com and set it as VOYAGE_API_KEY. Captures file fine without it; only search is affected, and anything captured meanwhile gets picked up later.",
    };
  }
  try {
    await embedTexts(["health check"], "query");
    return {
      id: "voyage",
      label: "Search embeddings (Voyage)",
      status: "ok",
      detail: `Key works, using ${EMBEDDING_MODEL}.`,
      remedy: null,
    };
  } catch (e) {
    return {
      id: "voyage",
      label: "Search embeddings (Voyage)",
      status: "warn",
      detail: `Voyage rejected the call: ${message(e)}`,
      remedy:
        "Copy the key again from dash.voyageai.com into VOYAGE_API_KEY. Filing keeps working regardless; only Ask your brain is affected.",
    };
  }
}

async function taxonomyCheck(): Promise<HealthCheck> {
  const db = createSupabaseAdminClient();
  const { data, error } = await db
    .from("destinations")
    .select("id, category:categories(slug)")
    .eq("is_active", true);

  if (error) {
    return {
      id: "taxonomy",
      label: "Your filing structure",
      status: "fail",
      detail: `Could not read the taxonomy: ${error.message}`,
      remedy: SCHEMA_REMEDY,
    };
  }
  if (!data?.length) {
    return {
      id: "taxonomy",
      label: "Your filing structure",
      status: "fail",
      detail: "There is nowhere to file anything yet.",
      remedy:
        "Build it on this page: describe your life and work in a paragraph, edit what Claude proposes, and confirm. It creates the pages in your Notion for you.",
    };
  }

  const rows = data as unknown as { id: string; category: { slug: string } | null }[];
  const hasCatchAll = rows.some((d) => d.category?.slug === CATCH_ALL_SLUG);
  if (!hasCatchAll) {
    return {
      id: "taxonomy",
      label: "Your filing structure",
      status: "warn",
      detail: `${rows.length} destinations, but none of them is the catch-all.`,
      remedy:
        "A thought that fits nothing else has nowhere to land and the capture fails. The catch-all is the category with the slug general-notes; it exists automatically when the structure is built on this page.",
    };
  }
  return {
    id: "taxonomy",
    label: "Your filing structure",
    status: "ok",
    detail: `${rows.length} destination${rows.length === 1 ? "" : "s"}, catch-all included.`,
    remedy: null,
  };
}

async function clickupCheck(): Promise<HealthCheck> {
  if (!clickupTokenConfigured()) {
    return {
      id: "clickup",
      label: "Work filing (ClickUp)",
      status: "skipped",
      detail: "Not set up. This one is optional: without it, every capture goes to Notion.",
      remedy: null,
    };
  }
  try {
    const teams = await getTeams();
    return {
      id: "clickup",
      label: "Work filing (ClickUp)",
      status: "ok",
      detail: `Token works, and can see ${teams.length} workspace${teams.length === 1 ? "" : "s"}. Choose which lists to file into on the Settings page.`,
      remedy: null,
    };
  } catch (e) {
    return {
      id: "clickup",
      label: "Work filing (ClickUp)",
      status: "warn",
      detail: `ClickUp rejected the token: ${message(e)}`,
      remedy:
        "Copy the token again from ClickUp, Settings, Apps, API Token into CLICKUP_API_TOKEN. Personal filing to Notion is unaffected.",
    };
  }
}

function deploymentCheck(): HealthCheck {
  const problems: string[] = [];
  const remedies: string[] = [];
  const isProd = process.env.VERCEL_ENV === "production" || process.env.NODE_ENV === "production";

  if (!process.env.NEXT_PUBLIC_APP_URL?.trim()) {
    problems.push("NEXT_PUBLIC_APP_URL is not set");
    remedies.push(
      "Set NEXT_PUBLIC_APP_URL to this app's own address. Every row filed into Notion carries a link back to its entry here, and without it those links point at localhost."
    );
  }
  if (!process.env.CRON_SECRET?.trim()) {
    problems.push("CRON_SECRET is not set");
    remedies.push(
      "Set CRON_SECRET to any long random string. It is the password on the scheduled jobs that retry failed writes and build the weekly review; they refuse to run without it."
    );
  }

  if (!problems.length) {
    return {
      id: "deployment",
      label: "Deployment settings",
      status: "ok",
      detail: "Backlink address and scheduled job password are both set.",
      remedy: null,
    };
  }
  return {
    id: "deployment",
    label: "Deployment settings",
    // Only a real problem once this is the deployed copy; locally it is noise.
    status: isProd ? "warn" : "skipped",
    detail: `${problems.join(", ")}.${isProd ? "" : " Only matters once this is deployed."}`,
    remedy: remedies.join(" "),
  };
}

/** Run every check. Each one owns its failure, so nothing here throws. */
export async function runHealthChecks(): Promise<HealthReport> {
  const settled = await Promise.all(
    [
      Promise.resolve(envCheck()),
      schemaCheck(),
      notionTokenCheck(),
      notionRootCheck(),
      anthropicCheck(),
      voyageCheck(),
      taxonomyCheck(),
      clickupCheck(),
      Promise.resolve(deploymentCheck()),
    ].map((p, i) =>
      p.catch(
        (e): HealthCheck => ({
          id: `check-${i}`,
          label: "Check failed to run",
          status: "fail",
          detail: message(e),
          remedy: "This one could not be tested at all. Reload the page to try again.",
        })
      )
    )
  );

  return {
    checks: settled,
    ready: settled.every((c) => c.status !== "fail"),
    checkedAt: new Date().toISOString(),
  };
}
