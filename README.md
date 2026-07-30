# Second Brain

Capture every thought by voice or text; Claude files it where it belongs.

A ramble like *"grab almond milk and dish soap, oh and an idea for the newsletter about why simple tools win"* becomes three separate, properly-titled entries — two grocery items and a newsletter idea — each filed into the right place in your Notion, with the full structured body written into the page. Nothing to sort later.

**Features**

- **Voice/text capture** — one box, browser speech recognition, no paid transcription.
- **Compound splitting** — every capture is treated as a potential multi-idea ramble and split into individually-filed thoughts.
- **Notion filing (Personal)** — rows in your databases ("banks") or appends into a live document section (e.g. a Current Draft's Notes heading). Structured thoughts become real Notion blocks — headings, bullets, bold.
- **ClickUp filing (Work, optional)** — work captures become tasks in your ClickUp lists, or append to an existing task when it's clearly the same piece of work. Low-confidence ideas are held for one-tap manual routing, never guessed.
- **Entry log** — every capture recorded in Postgres first (nothing is ever lost), with undo and reassign per filing.
- **Ask your brain** — semantic search over everything you've filed, answered by Claude with citations.
- **AI instructions you write in plain language** — tell it about your people, projects, and preferences; Claude compiles your words into precise rules it follows on every capture, and shows you exactly what it saved.
- **Weekly synthesis** — a Monday-morning Notion page: themes, connections between entries, suggested next actions.
- **Development prompts** — promising-but-thin ideas get 1–3 orange nudge questions written under them in Notion.
- **Notion is the source of truth** — restructure your workspace freely; `npm run sync` reconciles the app's taxonomy to match.

**Stack:** Next.js 15 · Supabase (Postgres + auth + pgvector) · Anthropic Claude · Notion API · Voyage AI embeddings · ClickUp API (optional) · Vercel (hosting + crons).

---

## Setup

You'll create free-tier accounts on a few services, paste keys into one env file, and deploy. Budget ~30 minutes.

**Prerequisites:** Node 20+, and accounts on [Supabase](https://supabase.com), [Notion](https://notion.so), [Anthropic Console](https://console.anthropic.com), [Voyage AI](https://dash.voyageai.com), and [Vercel](https://vercel.com). [ClickUp](https://clickup.com) only if you want the Work pathway.

### 1. Clone and install

```bash
git clone <this-repo>
cd <repo>
npm install
cp .env.local.example .env.local
```

Fill in `.env.local` as you go through the steps below.

### 2. Supabase (database + auth)

1. Create a project at [supabase.com/dashboard](https://supabase.com/dashboard).
2. Open **SQL Editor**, paste the entire contents of `supabase/schema.sql`, and click Run. That's the whole database in one file (it enables the `vector` extension for semantic search along the way).
3. From **Settings → API**, copy into `.env.local`:
   - Project URL → `NEXT_PUBLIC_SUPABASE_URL`
   - `anon` `public` key → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `service_role` key → `SUPABASE_SERVICE_ROLE_KEY` (server-only — never expose it)
4. **Authentication → Providers**: make sure Email is enabled. This is a single-user app — you'll create your one account in step 7.

### 3. Notion (where thoughts get filed)

1. Create an internal integration at [notion.so/my-integrations](https://www.notion.so/my-integrations) → copy the token to `NOTION_API_KEY`.
2. In Notion, create an empty page (e.g. "Second Brain") — this is your root. Everything the app files lives under it.
3. On that page: **⋯ menu → Connections → add your integration** (this grants the API access).
4. Copy the page's ID into `NOTION_ROOT_PAGE_ID` — it's the 32-character hex string at the end of the page URL.
5. Build your starter structure, either way:
   - **Seed it:** open `scripts/seed-taxonomy.ts`, edit the example taxonomy (clients, banks, channels) to match your life, then `npm run seed`. Keep the catch-all's `general-notes` slug.
   - **Or build it yourself in Notion** (databases = banks for rows; plain pages = documents to append into; pages containing others = categories), then run `npm run sync` to import the structure.

   Either way, Notion stays the source of truth afterwards — restructure there, then `npm run sync` (or the Sync button in the app).

### 4. Anthropic (the classifier)

Create an API key at [console.anthropic.com](https://console.anthropic.com) → `ANTHROPIC_API_KEY`. The default model (`claude-haiku-4-5`) is fast and cheap; classification runs one call per capture.

### 5. Voyage AI (semantic search embeddings)

Create a key at [dash.voyageai.com](https://dash.voyageai.com) → `VOYAGE_API_KEY`. The free tier covers personal volume many times over. If you add this later (or it ever fails), captures still file fine — run `npm run backfill:embeddings` any time to catch search up.

### 6. ClickUp (optional — the Work pathway)

Skip this entirely if you don't use ClickUp; the Work toggle simply won't appear.

1. ClickUp **Settings → Apps → API Token** → `CLICKUP_API_TOKEN`.
2. `npm run clickup:discover` — prints every list in your workspace, then a ready-to-paste `CLICKUP_LISTS=[…]` line containing all of them.
3. Copy that line into `.env.local`, delete any lists the Work pathway shouldn't file into, and replace each `TODO` description with routing guidance — the description is what the classifier reads to pick a list, so it's what makes work routing good.

The app deliberately has a tiny ClickUp permission surface: create tasks in a list's first ("dump") status and append to task descriptions. It never sets priorities, assignees, or statuses — triage stays yours.

### 7. First run

```bash
npm run set-password   # creates your login (prompts for email + password)
npm run dev
```

Open [localhost:3000](http://localhost:3000), sign in, and capture a thought. Check your Notion — it should appear within a few seconds, and the entry log (Entries tab) shows exactly what went where, with undo.

### Teach the AI your world (Instructions page)

The filing quality ceiling isn't the model — it's how much the model knows about your life. The **Instructions** tab is where you fix that, in plain language:

1. Type what you want, the way you'd tell a person: *"Kate is my sister — anything about her is family, not client work. Podcast recommendations go to Books to Read. Keep titles short."*
2. Hit **Compile & save**. Claude rewrites your wish into precise, literal rules the filing model follows on every capture — expanding nicknames into facts, turning vague wishes into concrete triggers, and pinning rules to your real destination names.
3. It shows you exactly what it saved (and tells you if part of your wish couldn't be honored, or if it clashes with one of your existing rules).

Each instruction is its own item: add more any time, and edit or delete any one of them without touching the rest. Filing not quite right? Open the offending rule, refine your words, recompile.

There are separate instruction sets for Personal filing, Work filing (when ClickUp is configured), and the Weekly synthesis. The **Weekly synthesis** set is where you tell it who your clients, channels, and projects are — that context shapes the Monday review's suggested next actions. (It's the in-app equivalent of the optional `SYNTHESIS_CONTEXT` env var; use whichever you prefer — an instruction wins if both are set.) Each empty section shows a few tappable example prompts to start from.

Your compiled rules override the built-in routing judgment when they conflict — but never the safety rules (manual Personal/Work choice, hold-don't-guess, the ClickUp permission scope, undo). The built-in prompts are viewable read-only on the same page, so there's no hidden behavior.

Also worth knowing: each category's routing behavior comes from its **description** in the taxonomy — `npm run sync` writes these for new categories, and sharper descriptions mean sharper filing. Instructions are for cross-cutting rules and personal facts; descriptions are for what belongs in each destination.

### 8. Deploy to Vercel

1. `npx vercel` (link the project), then set every variable from `.env.local` in **Vercel → Project → Settings → Environment Variables**. Also set:
   - `NEXT_PUBLIC_APP_URL` to your production URL (used for backlinks from Notion rows)
   - `CRON_SECRET` to a long random string (protects the cron endpoints)
   - `APP_TIMEZONE` to your IANA timezone (e.g. `America/New_York`) so the weekly synthesis dates match your week
2. In Supabase **Authentication → URL Configuration**, set the Site URL to your production URL.
3. `npx vercel deploy --prod`. The two crons in `vercel.json` register on deploy:
   - `retry-failed` — daily, retries any Notion/ClickUp write that failed
   - `weekly-synthesis` — Sundays 20:00 **UTC**. Vercel crons are UTC-only, so shift the schedule to land on your Monday morning (e.g. New York: `0 11 * * 1` ≈ 6–7am Monday; Sydney: `0 20 * * 0`).

---

## Env var reference

| Variable | Required | Purpose |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` | ✓ | Supabase project + browser auth |
| `SUPABASE_SERVICE_ROLE_KEY` | ✓ | Server-side DB writes (never exposed) |
| `NOTION_API_KEY` / `NOTION_ROOT_PAGE_ID` | ✓ | Notion integration + root page |
| `ANTHROPIC_API_KEY` | ✓ | Claude classification/synthesis/Q&A |
| `ANTHROPIC_MODEL` | — | Defaults to `claude-haiku-4-5` |
| `VOYAGE_API_KEY` | ✓ | Embeddings for ask-your-brain |
| `VOYAGE_MODEL` | — | Defaults to `voyage-3.5-lite` (keep 1024-dim) |
| `NEXT_PUBLIC_APP_URL` | ✓ (prod) | Backlink URL written into Notion rows |
| `CRON_SECRET` | ✓ (prod) | Bearer token guard on `/api/cron/*` |
| `APP_TIMEZONE` | — | IANA tz for synthesis dates (default UTC) |
| `SYNTHESIS_CONTEXT` | — | A sentence about you; sharpens weekly next-actions |
| `CLICKUP_API_TOKEN` / `CLICKUP_LISTS` | — | Enables the Work pathway when both set |

## npm scripts

| Script | What it does |
| --- | --- |
| `npm run dev` / `build` / `start` | Next.js |
| `npm run seed` | Create the starter Notion structure + taxonomy (empty DB only — edit first) |
| `npm run sync` | Reconcile taxonomy from your Notion structure |
| `npm run set-password` | Create/update the app login |
| `npm run smoke` | End-to-end classify→file test against live services |
| `npm run check:markdown` | Unit checks for the Markdown→Notion converter |
| `npm run backfill:embeddings` | Embed any filed items missing from semantic search |
| `npm run clickup:discover` | Print your ClickUp workspace's lists + IDs |

## Troubleshooting

- **"Could not find the '…' column … in the schema cache"** — the schema isn't fully applied. Re-run `supabase/schema.sql` in the SQL Editor (it's safe to run on a fresh database).
- **"No destinations found — run `npm run seed` first."** — the taxonomy is empty: seed it, or build structure in Notion and `npm run sync`.
- **Capture filed but search can't find it** — embeddings lagged (missing `VOYAGE_API_KEY` or a transient failure). Failed embeddings retry via the daily cron; `npm run backfill:embeddings` fixes it immediately.
- **"Heading 'X' not found — appended at end of page"** — a document destination's configured section heading was renamed in Notion; the content still landed (end of page). Fix the heading or re-sync.
- **Work toggle missing** — `CLICKUP_LISTS` isn't set (or is empty). That's the intended off-state for the ClickUp pathway.
- **Cron didn't run** — crons only register on a production deploy, and Vercel sends `Authorization: Bearer CRON_SECRET` — make sure the env var is set in Vercel.

## How it works

Durability first: every capture is written to Postgres before any AI or filing call, so a failure can never lose a thought. One Claude call classifies, splits, titles, and formats; each idea is then written to its destination, logged in `entry_destinations` (with undo metadata), and embedded for search. Failures land in a retry queue drained by the daily cron. The full design — data model, write mechanics, confidence gates — is in [ARCHITECTURE.md](ARCHITECTURE.md).

## License

MIT — see [LICENSE](LICENSE).
