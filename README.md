# Second Brain

Capture every thought by voice or text; Claude files it where it belongs.

A ramble like *"grab almond milk and dish soap, oh and an idea for the newsletter about why simple tools win"* becomes three separate, properly-titled entries - two grocery items and a newsletter idea - each filed into the right place in your Notion, with the full structured body written into the page. Nothing to sort later.

**Features**

- **Voice/text capture** - one box, browser speech recognition, no paid transcription.
- **Compound splitting** - every capture is treated as a potential multi-idea ramble and split into individually-filed thoughts.
- **Notion filing (Personal)** - rows in your databases ("banks") or appends into a live document section (e.g. a Current Draft's Notes heading). Structured thoughts become real Notion blocks - headings, bullets, bold.
- **ClickUp filing (Work, optional)** - work captures become tasks in your ClickUp lists, or append to an existing task when it's clearly the same piece of work. Low-confidence ideas are held for one-tap manual routing, never guessed.
- **Entry log** - every capture recorded in Postgres first (nothing is ever lost), with undo and reassign per filing.
- **Ask your brain** - semantic search over everything you've filed, answered by Claude with citations.
- **AI instructions you write in plain language** - tell it about your people, projects, and preferences; Claude compiles your words into precise rules it follows on every capture, and shows you exactly what it saved.
- **Weekly synthesis** - a Monday-morning Notion page: themes, connections between entries, suggested next actions.
- **Development prompts** - promising-but-thin ideas get 1–3 orange nudge questions written under them in Notion.
- **Guided setup** - describe your life in a paragraph and Claude proposes your filing structure; you edit it and it gets built in your Notion for you. A health check tests every service and names the exact fix for anything broken.
- **Notion is the source of truth** - restructure your workspace freely; Sync from Notion reconciles the app's taxonomy to match.

**Stack:** Next.js 15 · Supabase (Postgres + auth + pgvector) · Anthropic Claude · Notion API · Voyage AI embeddings · ClickUp API (optional) · Vercel (hosting + crons).

---

## Setup

You'll create free-tier accounts on a few services, paste keys into one env file, and deploy. Budget ~30 minutes.

Everything after the keys happens inside the app: you create your login, build your filing structure, and check that each service is connected, all from the **Setup** page. No code editing, and nothing to run from a terminal.

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
   - `service_role` key → `SUPABASE_SERVICE_ROLE_KEY` (server-only - never expose it)
4. **Authentication → Providers**: make sure Email is enabled. This is a single-user app - you'll create your one account in step 7.

### 3. Notion (where thoughts get filed)

1. Create an internal integration at [notion.so/my-integrations](https://www.notion.so/my-integrations) → copy the token to `NOTION_API_KEY`.
2. In Notion, create an empty page (e.g. "Second Brain") - this is your root. Everything the app files lives under it.
3. On that page: **⋯ menu → Connections → add your integration** (this grants the API access).
4. Copy the page's ID into `NOTION_ROOT_PAGE_ID` - it's the 32-character hex string at the end of the page URL.

Leave the page empty. You build the structure inside it from the app in step 7, once you can sign in.

Step 3 is the step people get wrong, and the symptom is misleading: Notion answers **404** for a page that exists but hasn't been shared with your integration, so a forgotten Connections step looks exactly like a wrong page ID. The Setup page's health check calls this out by name.

### 4. Anthropic (the classifier)

Create an API key at [console.anthropic.com](https://console.anthropic.com) → `ANTHROPIC_API_KEY`. The default model (`claude-haiku-4-5`) is fast and cheap; classification runs one call per capture.

### 5. Voyage AI (semantic search embeddings)

Create a key at [dash.voyageai.com](https://dash.voyageai.com) → `VOYAGE_API_KEY`. The free tier covers personal volume many times over. If you add this later (or it ever fails), captures still file fine - run `npm run backfill:embeddings` any time to catch search up.

### 6. ClickUp (optional - the Work pathway)

Skip this entirely if you don't use ClickUp; the Work toggle simply won't appear.

Set `CLICKUP_API_TOKEN` from ClickUp **Settings → Apps → API Token**. That's the only env var involved - you choose the lists themselves in the app, on the **Settings** tab: hit **Find my lists**, add the ones work captures may be filed into, and write a description for each.

The description is what the classifier reads to pick a list, so it's what makes work routing good. **Suggest from tasks in the list** drafts one from the work already in that list if you'd rather edit than write.

Adding a list later is the same three clicks, with no redeploy: make it in ClickUp, refresh the picker in Settings, add it, describe it, save.

The app deliberately has a tiny ClickUp permission surface: read your lists and their open tasks, create tasks in a list's first ("dump") status, and append to task descriptions. It never sets priorities, assignees, or statuses - triage stays yours.

### 7. First run: create your account, then your structure

```bash
npm run dev
```

Open [localhost:3000](http://localhost:3000). (Deploying first and doing this on the live URL works exactly the same; see step 8.)

**Create your account.** Since no account exists yet, the login page offers to create one. That first account is the only one, and the form reverts to a plain sign-in immediately after. (`npm run set-password` still exists for resetting that password later.)

**Check the connections.** Open **Setup** from the menu. It tests every service in turn - database tables, Notion token, root page, Claude, embeddings, ClickUp - and for anything broken it tells you the specific thing to go and change. Fix whatever it flags before continuing; a red check here is a capture that fails later.

**Build your filing structure.** Same page, once the checks are green. Describe your life and work in a paragraph or two, the way you'd brief a new assistant: what you do, who for, what you make, what you catch yourself wanting to note down. Claude proposes a set of categories and the concrete places to file into, and you edit it:

- Rename or delete anything, add what's missing.
- Choose what each place is: a **list that collects items** (a Notion database, one row per thought) or a **document thoughts get added to** (one page, appended under a heading, for something you're actively writing).
- Tick **merge repeats** on shopping-style lists so "milk" and "a gallon of milk" don't become two lines.
- Edit each category's description. This is the part that matters: it's the only thing the classifier reads when deciding where a thought belongs, so say what belongs there *and* what doesn't, naming anything it could be confused with.

Confirm, and it creates the pages, databases, and documents in your Notion, records the taxonomy, and syncs. One category is always the catch-all, so a thought that fits nothing else still lands somewhere.

From here **Notion is the source of truth**: add, rename, or move pages there whenever you like, then hit **Sync from Notion** at the bottom of any page. Setup won't rebuild over an existing structure; that's what syncing is for.

**Capture a thought** and check your Notion: it should appear within a few seconds, and the entry log (Entries tab) shows exactly what went where, with undo.

### Teach the AI your world (Instructions page)

The filing quality ceiling isn't the model - it's how much the model knows about your life. The **Instructions** tab is where you fix that, in plain language:

1. Type what you want, the way you'd tell a person: *"Kate is my sister - anything about her is family, not client work. Podcast recommendations go to Books to Read. Keep titles short."*
2. Hit **Compile & save**. Claude rewrites your wish into precise, literal rules the filing model follows on every capture - expanding nicknames into facts, turning vague wishes into concrete triggers, and pinning rules to your real destination names.
3. It shows you exactly what it saved (and tells you if part of your wish couldn't be honored, or if it clashes with one of your existing rules).

Each instruction is its own item: add more any time, and edit or delete any one of them without touching the rest. Filing not quite right? Open the offending rule, refine your words, recompile.

There are separate instruction sets for Personal filing, Work filing (when ClickUp is configured), and the Weekly synthesis. The **Weekly synthesis** set is where you tell it who your clients, channels, and projects are - that context shapes the Monday review's suggested next actions. (It's the in-app equivalent of the optional `SYNTHESIS_CONTEXT` env var; use whichever you prefer - an instruction wins if both are set.) Each empty section shows a few tappable example prompts to start from.

Your compiled rules override the built-in routing judgment when they conflict - but never the safety rules (manual Personal/Work choice, hold-don't-guess, the ClickUp permission scope, undo). The built-in prompts are viewable read-only on the same page, so there's no hidden behavior.

Also worth knowing: each category's routing behavior comes from its **description** in the taxonomy - you write these when you build the structure on the Setup page, and syncing writes one for any category you later add in Notion. Sharper descriptions mean sharper filing. Instructions are for cross-cutting rules and personal facts; descriptions are for what belongs in each destination.

### 8. Deploy to Vercel

You can do this before step 7 instead, and run the whole of step 7 against the live URL: nothing in it needs a local checkout.

1. `npx vercel` (link the project), then set every variable from `.env.local` in **Vercel → Project → Settings → Environment Variables**. Deploying before you have created your account is fine, but sign in and create it promptly: the first-run form is open to whoever reaches the URL first, and closes permanently once an account exists. Also set:
   - `NEXT_PUBLIC_APP_URL` to your production URL (used for backlinks from Notion rows)
   - `CRON_SECRET` to a long random string (protects the cron endpoints)
   - `APP_TIMEZONE` to your IANA timezone (e.g. `America/New_York`) so the weekly synthesis dates match your week
2. In Supabase **Authentication → URL Configuration**, set the Site URL to your production URL.
3. `npx vercel deploy --prod`. The two crons in `vercel.json` register on deploy:
   - `retry-failed` - daily, retries any Notion/ClickUp write that failed
   - `weekly-synthesis` - Sundays 20:00 **UTC**. Vercel crons are UTC-only, so shift the schedule to land on your Monday morning (e.g. New York: `0 11 * * 1` ≈ 6–7am Monday; Sydney: `0 20 * * 0`).

---

## Env var reference

| Variable | Required | Purpose |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` | ✓ | Supabase project + browser auth |
| `SUPABASE_SERVICE_ROLE_KEY` | ✓ | Server-side DB writes (never exposed) |
| `NOTION_API_KEY` / `NOTION_ROOT_PAGE_ID` | ✓ | Notion integration + root page |
| `ANTHROPIC_API_KEY` | ✓ | Claude classification/synthesis/Q&A |
| `ANTHROPIC_MODEL` | - | Defaults to `claude-haiku-4-5` |
| `VOYAGE_API_KEY` | ✓ | Embeddings for ask-your-brain |
| `VOYAGE_MODEL` | - | Defaults to `voyage-3.5-lite` (keep 1024-dim) |
| `NEXT_PUBLIC_APP_URL` | ✓ (prod) | Backlink URL written into Notion rows |
| `CRON_SECRET` | ✓ (prod) | Bearer token guard on `/api/cron/*` |
| `APP_TIMEZONE` | - | IANA tz for synthesis dates (default UTC) |
| `SYNTHESIS_CONTEXT` | - | A sentence about you; sharpens weekly next-actions |
| `CLICKUP_API_TOKEN` | - | Enables the Work pathway; the lists themselves are chosen in Settings |
| `CLICKUP_LISTS` | - | Legacy fallback, used only until you save lists in Settings |

## npm scripts

None of these are needed for setup, which happens entirely in the app. They exist for maintenance and for anyone who prefers a terminal.

| Script | What it does |
| --- | --- |
| `npm run dev` / `build` / `start` | Next.js |
| `npm run sync` | Reconcile taxonomy from your Notion structure (the Sync from Notion button does this) |
| `npm run seed` | The old scripted alternative to the Setup page: creates a starter structure from a hardcoded example you edit in `scripts/seed-taxonomy.ts` first. Empty database only |
| `npm run set-password` | Reset the app login password (first-time setup happens in-app) |
| `npm run smoke` | End-to-end classify→file test against live services |
| `npm run check:markdown` | Unit checks for the Markdown→Notion converter |
| `npm run backfill:embeddings` | Embed any filed items missing from semantic search |
| `npm run clickup:discover` | Print your ClickUp workspace's lists + IDs (the Settings page does this with a picker) |

## Troubleshooting

**Start on the Setup page.** Its health check tests every service and names the exact fix for each failure, which is faster than matching a symptom below. The rest of this list covers things it can't see.

- **Notion says the root page doesn't exist (404)** - nine times out of ten the page was never shared with your integration, not that the ID is wrong. Open the page in Notion, **⋯ menu → Connections → your integration**. Notion returns an identical 404 for both causes, which is why this one wastes so much time.
- **"Could not find the '…' column … in the schema cache"** - the schema isn't fully applied. Re-run `supabase/schema.sql` in the SQL Editor (it's safe to run on a fresh database).
- **"There is nowhere to file this yet"** - the taxonomy is empty. Build it on the **Setup** page, or build structure in Notion yourself and hit **Sync from Notion**.
- **Setup won't let me rebuild my structure** - by design: it only builds into an empty taxonomy, so it can't quietly duplicate what you have. Change the structure in Notion (rename, move, add, delete), then **Sync from Notion**.
- **Capture filed but search can't find it** - embeddings lagged (missing `VOYAGE_API_KEY` or a transient failure). Failed embeddings retry via the daily cron; `npm run backfill:embeddings` fixes it immediately.
- **"Heading 'X' not found - appended at end of page"** - a document destination's configured section heading was renamed in Notion; the content still landed (end of page). Fix the heading or re-sync.
- **Work toggle missing** - no ClickUp lists are configured. Add them on the Settings tab (or set `CLICKUP_API_TOKEN` first if that section says it's missing). No lists is the intended off-state for the ClickUp pathway.
- **Settings says the work_lists table doesn't exist** - your database predates it. Re-run `supabase/schema.sql` in the SQL Editor. Until then the Work pathway falls back to the `CLICKUP_LISTS` env var.
- **Cron didn't run** - crons only register on a production deploy, and Vercel sends `Authorization: Bearer CRON_SECRET` - make sure the env var is set in Vercel.

## How it works

Durability first: every capture is written to Postgres before any AI or filing call, so a failure can never lose a thought. One Claude call classifies, splits, titles, and formats; each idea is then written to its destination, logged in `entry_destinations` (with undo metadata), and embedded for search. Failures land in a retry queue drained by the daily cron. The full design - data model, write mechanics, confidence gates - is in [ARCHITECTURE.md](ARCHITECTURE.md).

## License

MIT - see [LICENSE](LICENSE).
