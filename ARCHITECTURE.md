# Second Brain Ingestion Tool - Architecture

**Status:** Built (Notion pathway). Later additions not covered by this design doc: the optional ClickUp Work pathway, ask-your-brain semantic search (Voyage + pgvector), the weekly synthesis cron, Markdown→Notion-blocks filing, AI development prompts, and in-app setup (§16) - see the README for how those behave and are configured.
**Deliverable of this doc:** the reference design for the core capture→classify→Notion pipeline.

---

## 1. What this is

A single-user tool for capturing thoughts from a phone or computer at any moment - a web page with a microphone button and a text box - and having AI automatically clean them up and file them into an organized "second brain" in Notion, while keeping an independent, permanent log of every raw capture and everywhere it ended up.

Example inputs it must handle well:

- A video/content idea after watching a TikTok
- A thought for a piece of writing in progress ("open with the failure, not the fix")
- Gear the owner wants to buy, and why
- Grocery items rattled off while looking at the cupboard
- Client work notes
- General learnings and personal reflections

Core behaviors:

1. **Capture** - voice (transcribed in-browser) or typed text, from any device, near-zero friction.
2. **Multi-destination routing** - one entry can land in several places at once. A draft thought about family gets appended to the piece currently being written on that topic *and* to a family idea bank - creating that bank if it doesn't exist.
3. **Neat filing** - content is cleaned and formatted by the LLM before writing, not dumped raw; appended at the bottom of the relevant list or document section.
4. **Master entry log** - every raw entry recorded with a timestamp and links to every Notion destination it was filed to. "Everything I've entered" and "the organized end state" are both always available.
5. **Follow-ups** - "if there's a supporting scripture for that thought, add it too" resolves against recent entries and files adjacent to the original.
6. **Semantic dedup** - for list destinations (groceries especially): "milk", "2% milk", and "a gallon of milk" don't become three lines; items already on the list aren't re-added.
7. **Auto-file with undo** - files immediately for speed; every action is visible in the entry log with one-tap undo/reassign.

---

## 2. Locked-in decisions

| Decision | Choice | Rationale |
|---|---|---|
| Destination platform | **Notion** | Official API with real databases, page content editing, relations; good mobile/web apps for manual edits alongside the tool |
| Entry log location | **Separate Postgres (Supabase)** | Source of truth independent of Notion's query limits; enables fast search, undo, audit tooling |
| Transcription | **Browser Web Speech API (free)** | Zero cost; accuracy ceiling accepted and mitigated (see §10) |
| Filing behavior | **Auto-file immediately, visible undo** | True to the "funnel" concept; mistakes are cheap to fix, not prevented by friction |
| Stack | **Next.js + Supabase + Vercel** | Mainstream, generous free tiers, zero server maintenance |
| Taxonomy | **Arbitrary-depth nested tree, live from Postgres** | The owner wants "databases within databases" and can reshape the tree anytime; routing follows automatically |
| Dedup | **Semantic, LLM judgment** | String matching can't handle "milk" vs "a gallon of milk" |
| Auth | **Single-user Supabase email+password** | Personal tool; enough to keep it off the open internet. Was magic link - replaced because PKCE links break when opened in a different browser context (mail webview / PWA vs Safari), causing constant re-logins |
| AI model | **Claude Haiku 4.5** (env-configurable) | Cheap/fast, sufficient for routing at personal volume; bump to Sonnet 5 if judgment feels shallow |

---

## 3. High-level architecture

```
Browser (mic/text UI)
   │  Web Speech API transcribes locally, shown editable before submit
   ▼
Next.js API route ── Supabase session verified ──▶
   │
   ├─ 1. Write raw entry to Postgres immediately (durability first)
   ├─ 2. Fetch recent context (last 5–10 entries) + live taxonomy tree (prompt-cached)
   ├─ 3. Single Claude call: classify + route + resolve follow-up + format content
   ├─ 4. Dedup-enabled destinations: fetch live Notion content → second Claude call
   │      decides append-new vs merge-into-existing
   ├─ 5. Write to Notion (create row / append block / update block)
   ├─ 6. Record entry_destinations + classification_runs rows
   └─ 7. Return destinations, Notion links, undo affordances to UI

Background: Vercel Cron retries failed Notion writes via a Postgres job_queue table
```

The whole pipeline runs synchronously in one API route for the first phases - typical latency is a few seconds (client-side transcription is free, the Claude call is ~1–3s, each Notion call ~0.2–0.5s), well within Vercel function limits. Failures go to a retry queue rather than blocking or being lost. If latency grows (e.g. new-category creation chaining several Notion calls), promote to a background job in a later phase.

---

## 4. Nested taxonomy - "databases within databases"

This is the piece the owner flagged explicitly: the structure must support deep, multi-level nesting, and they must be able to reshape it later with the tool still routing correctly.

### Postgres model

`categories` is a **self-referencing tree** (`parent_category_id`), unbounded depth. `destinations` - concrete Notion filing targets - attach to *any* node, not just leaves. A mid-tree node can itself be a filing target while also having children:

```
Clients                        ← container node
└─ Acme Corp                   ← node with destinations (Project Notes, Meeting Log)
   └─ Project X                ← deeper node with its own destinations
```

Nothing about depth or category names is hardcoded. Every classification call renders the **current live tree** from Postgres into the prompt as an indented outline. Rename, re-parent, merge, or add a level - the very next entry routes against the new shape with zero code changes.

### Notion mapping

Notion databases can't literally nest inside each other, but **pages nest infinitely**, and database rows *are* pages. So nesting is modeled as container pages holding child databases, recursively:

- A top-level page ("Clients") contains child pages (one per client) or a database.
- Each database row-page can itself contain more child databases (a client's row-page holds a "Project Notes" database and a "Meeting Log" database).

This is a standard, fully supported Notion pattern. `destinations` stores whichever Notion id applies (`notion_database_id` or `notion_page_id`).

### Routing at depth

The model picks the **most specific node it's confident about**. If only an ancestor is confident ("this is client work, but I can't tell which project"), it files at that level and the entry is flagged "filed at parent level - consider refining" rather than guessing a wrong leaf. New nodes can be proposed at any depth - a new leaf under an existing branch, or a whole new branch - always created visibly with one-tap undo/merge.

### Starter shape (seed only - reshape freely later)

```
Second Brain
├─ Clients                                (container; more clients added as needed)
│   ├─ Acme Co      → Project Notes (bank), Meeting Log (bank)
│   └─ Globex       → Project Notes (bank), Meeting Log (bank)
├─ Writing
│   ├─ Article Ideas                      (bank)
│   └─ Current Draft                      (document; flagged "current focus")
├─ Books to Read                          (bank, dedup on - loose matching)
├─ Gear / Wishlist                        (bank, dedup on - loose matching)
├─ Groceries                              (bank, dedup on - strict matching)
├─ Content Ideas                          (container - the owner's own content, by channel)
│   ├─ Instagram / TikTok                 (bank - short-form, one combined group)
│   ├─ YouTube                            (bank)
│   └─ Newsletter                         (bank)
└─ General Learnings / Notes              (catch-all + low-confidence landing zone)
```

Routing note: client work vs the owner's own content is a key disambiguation - an idea "for
Acme's Instagram" goes to *Acme Co → Project Notes*, not *Content Ideas → Instagram / TikTok*.
Category descriptions in the seed data should state this explicitly so the classifier gets it
right from day one. An idea that doesn't clearly name a channel files at the *Content Ideas*
parent level with the "consider refining" flag rather than guessing a channel.

---

## 5. Data model (Supabase / Postgres)

```sql
-- Taxonomy registry - self-referencing tree mirroring what exists in Notion
create table categories (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  name text not null,
  description text not null,          -- used as LLM routing context
  parent_category_id uuid references categories(id),
  is_seed boolean not null default false,
  is_active boolean not null default true,
  created_by text not null default 'system' check (created_by in ('system','llm','user')),
  created_at timestamptz not null default now()
);

-- A concrete Notion filing target; attaches to any tree node
create table destinations (
  id uuid primary key default gen_random_uuid(),
  category_id uuid not null references categories(id),
  kind text not null check (kind in ('bank_database','document_section')),
  notion_database_id text,             -- kind = bank_database
  notion_page_id text,                 -- kind = document_section
  notion_section_heading text,         -- e.g. "Illustrations"
  title text not null,
  dedup_enabled boolean not null default false,
  is_current_focus boolean not null default false, -- e.g. the draft being written now
  summary text,                        -- LLM-maintained short summary, cheap routing context
  summary_updated_at timestamptz,
  is_active boolean not null default true,
  created_by text not null default 'system' check (created_by in ('system','llm','user')),
  created_at timestamptz not null default now()
);

-- Master entry log - source of truth for every raw capture
create table entries (
  id uuid primary key default gen_random_uuid(),
  source text not null check (source in ('voice','text')),
  raw_transcript text not null,
  edited_transcript text,              -- if user edited before submit
  transcript_confidence numeric,       -- Web Speech API confidence, if available
  status text not null default 'pending'
    check (status in ('pending','classifying','filed','partial_error','error','retracted')),
  followup_of_entry_id uuid references entries(id),
  created_at timestamptz not null default now()
);

-- Every Notion write an entry produced
create table entry_destinations (
  id uuid primary key default gen_random_uuid(),
  entry_id uuid not null references entries(id),
  destination_id uuid not null references destinations(id),
  action_type text not null check (action_type in
    ('append_row','append_block','merge_update','create_destination')),
  notion_page_id text,
  notion_block_ids jsonb,              -- exact block ids created (enables precise undo)
  content_snippet text not null,       -- the cleaned/formatted text actually filed
  before_content text,                 -- snapshot for merge_update - exact undo
  created_new_category boolean not null default false,
  undone_at timestamptz,
  undone_reason text,
  created_at timestamptz not null default now()
);

-- Full audit of every LLM call (debuggability + cost tracking)
create table classification_runs (
  id uuid primary key default gen_random_uuid(),
  entry_id uuid not null references entries(id),
  model text not null,
  prompt_version text not null,
  raw_response jsonb not null,
  latency_ms integer,
  input_tokens integer,
  output_tokens integer,
  cache_read_tokens integer,
  cost_estimate_usd numeric,
  created_at timestamptz not null default now()
);

-- Undo / reassign audit trail
create table undo_log (
  id uuid primary key default gen_random_uuid(),
  entry_id uuid not null references entries(id),
  entry_destination_id uuid references entry_destinations(id),
  action text not null check (action in ('undo','reassign','undo_new_category')),
  before_state jsonb,
  after_state jsonb,
  created_at timestamptz not null default now()
);

-- Background retry queue (no separate job service needed)
create table job_queue (
  id uuid primary key default gen_random_uuid(),
  job_type text not null,              -- 'retry_notion_write' | 'refresh_summary'
  payload jsonb not null,
  status text not null default 'queued' check (status in ('queued','processing','done','failed')),
  attempts integer not null default 0,
  last_error text,
  run_after timestamptz not null default now(),
  created_at timestamptz not null default now()
);
```

**RLS:** enabled on every table as defense in depth (single authenticated-user policy). All writes go through server-side API routes using the Supabase service-role key, so RLS mainly guards against accidental client-side queries.

---

## 6. Notion write mechanics

**Parent page:** `🧠 Second Brain`, explicitly shared with the internal Notion integration (Notion requires per-page sharing with integrations).

Two destination patterns, matching `destinations.kind`:

### Bank (database)

For list-like destinations - Groceries, Gear, Content Ideas, Books, catch-all Notes, per-client logs. Properties: `Title`, `Note` (rich text), `Added` (date), `Entry Log` (URL → deep link back to `/entries/{id}` in the app - the Notion→app backlink). **Appending = `pages.create({ parent: { database_id }, properties })`.** Trivial and reliable.

### Document section

For long-form pages being actively written (a current draft). Stores `notion_page_id` + `notion_section_heading` (e.g. "Illustrations"). Appending to the bottom of a *section*, not the whole page:

1. `blocks.children.list(page_id)` (paginated) to find the heading block matching `notion_section_heading` and the boundary before the next same-or-higher-level heading.
2. `blocks.children.append({ block_id: page_id, children: [...], after: lastBlockIdInSection })` - Notion's `after` parameter inserts immediately after a specific block.
3. If the heading doesn't exist yet: create it plus the content at the end of the page, record the new heading's block id.
4. **Resilience:** if the owner manually restructures the page and the heading is gone, fall back to end-of-page append and flag a warning on the entry - never a silent misfile.
5. Optional per-category toggle: a small trailing italic link back to `/entries/{id}` (may be unwanted clutter inside the prose).

**Backlinks:** app → Notion is native - every `entry_destinations` row stores the exact page/block ids, so the entry detail view deep-links to the precise Notion location. Notion → app uses the `Entry Log` URL property (banks) or the optional trailing link (documents).

**Dynamic category creation:** the pipeline creates the Notion database/page under the right parent, inserts `categories`/`destinations` rows, and sets `created_new_category = true` so the entry log badges it prominently ("created new: Health & Fitness") with easy undo/merge.

---

## 7. Classification & routing

### Context strategy - no embeddings for MVP

- Every classification call gets a compact taxonomy block: the full indented tree with each node's `description` + short LLM-maintained `summary` (1–3 sentences, refreshed after writes). A few KB even at dozens of nodes - sent every call and **prompt-cached** as the stable prefix (big cost/latency win).
- Full Notion content is fetched **only** when needed: (a) a selected destination is dedup-enabled - fetch its current items live (bank lists are naturally short); (b) a document append needs section-boundary detection.
- For a catch-all that grows large, pass only the most recent N items for dedup (near-duplicates are almost always temporally close). Embeddings/pgvector is a Phase 5+ option only if a bank becomes genuinely unwieldy.

### Structured output

Use the Anthropic SDK's structured-output support (Zod schema) so the result is guaranteed-valid JSON - the pipeline parses it programmatically with no free-text fallback:

```ts
{
  is_followup: boolean,
  followup_target_entry_id: string | null,
  destinations: Array<{
    category_slug: string | null,       // null when proposing new
    new_category?: { name: string, description: string,
                     parent_slug: string | null,
                     kind: 'bank_database' | 'document_section' },
    confidence: number,
    formatted_content: string,          // cleaned-up text to file, not raw transcript
  }>,
  low_confidence_fallback: boolean,     // route to catch-all if true
}
```

### Model

`claude-haiku-4-5` by default ($1/$5 per MTok - roughly $0.001–0.004 per entry at this workload), set via `ANTHROPIC_MODEL` env var. If routing/dedup judgment feels shallow on multi-destination calls, flip to `claude-sonnet-5` - at personal volume the absolute difference is cents per month, so choose on observed quality, not price. No extended thinking; this is a fast-path classification call.

### New-category safety

Created immediately (consistent with auto-file) but never silently: `created_new_category` flag, distinct entry-log badge, and a one-tap "merge into existing X instead" action to cheaply correct over-eager creation - the main sprawl risk.

---

## 8. Follow-ups ("add supporting scripture to that")

No formal session model. Every classification call includes the **last 5–10 entries** (id, short text, destinations filed) as candidate referents; the model does explicit reference resolution (`is_followup`, `followup_target_entry_id`) from recency and phrasing. The UI shows a "referring to: [snippet]" chip with manual override, since occasional misresolution is inevitable and cheap to fix.

A resolved follow-up biases toward the parent's exact destinations and block ids, so the addition lands **physically adjacent** - scripture appended right next to the original thought via `after`-insertion, not just somewhere on the same page.

---

## 9. Undo / reassign

Every destination badge in the entry log gets Undo and Reassign:

| Write type | Undo mechanism |
|---|---|
| `append_row` | Archive the Notion page (`pages.update({ archived: true })`) - recoverable in Notion trash, never hard-deleted |
| `append_block` | Delete the specific stored block id(s) via `blocks.delete` |
| `merge_update` | Revert to the stored `before_content` snapshot (why merges must always snapshot) |
| `create_destination` | Archive the Notion database/page; set `is_active = false` in Postgres |

`POST /api/entries/:id/undo { destinationId }` and `POST /api/entries/:id/reassign { fromDestinationId, toDestinationId | toNewCategoryName }`. Reassign = undo-then-refile, both steps written to `undo_log` ("moved from Groceries to Gear Wishlist at 3:42pm").

Editing a transcript after filing never silently mutates Notion - it's an explicit "refile with corrected text" action (undo existing destinations → reclassify → refile).

---

## 10. Voice input & the Web Speech API tradeoff

Free browser transcription was chosen knowingly over Whisper/Deepgram. The consequences and mitigations:

- **Accuracy ceiling** - always show the live transcript in an **editable text box before submission**. Filing still feels like one tap after a glance; nothing is auto-filed from an unseen transcript.
- **iOS Safari inconsistency** - feature-detect (`'webkitSpeechRecognition' in window`); where unsupported, hide the mic and fall back to text-only with a short note. Text input is the reliable path, not an edge case.
- Optional power-user toggle: auto-submit after N seconds of silence (default off).

If accuracy proves too frustrating in practice, swapping in a cloud transcription API later is an isolated change (one client-side capture component + one API route) - it doesn't touch the pipeline.

---

## 11. Auth & secrets

- Supabase Auth, **email + password** (password-manager autofill; signs in in-place). Replaced the original magic link: its PKCE flow must complete in the browser context that requested it, which phone mail-app/PWA handoffs routinely break. `/auth/callback` is kept only for dashboard-sent password-recovery emails; `npm run set-password` resets the password via the admin API.
- **First run:** the single account is created in-app. `/login` calls `needsFirstRunSetup()` (`lib/auth/setup.ts`), which is true only when the project has zero users, and switches the form to account creation; `POST /api/setup/account` re-checks that same condition and is the entire guard, so the route can never create a second account. Any failure reading the user list answers false, which fails closed to a sign-in form. Without this, a deployment that was never cloned locally had no way to produce a login at all, since the Supabase dashboard cannot set passwords.
- `@supabase/ssr` cookie sessions; `middleware.ts` guards everything except `/login`, `/auth`, `/api/setup` (self-guarding, above), and `/api/cron` (guarded by `CRON_SECRET`).
- Every API route re-verifies the session server-side before touching Notion or Anthropic.
- `NOTION_API_KEY`, `ANTHROPIC_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY` are server-only Vercel env vars - never `NEXT_PUBLIC_*`.

---

## 12. Project structure (Next.js App Router)

```
app/
  (auth)/login/page.tsx
  (app)/page.tsx                      -- capture UI (mic + text)
  (app)/entries/page.tsx              -- entry log (list/search/filter)
  (app)/entries/[id]/page.tsx         -- entry detail: transcript, destinations, undo
  (app)/taxonomy/page.tsx             -- browse/rename/merge/re-parent tree nodes
  (app)/settings/page.tsx             -- Notion status, model config, cost dashboard
  api/entries/route.ts                -- POST: ingest pipeline entrypoint
  api/entries/[id]/route.ts           -- GET / PATCH
  api/entries/[id]/undo/route.ts
  api/entries/[id]/reassign/route.ts
  api/categories/route.ts
  api/cron/retry-failed/route.ts      -- Vercel Cron target
  api/cron/refresh-summaries/route.ts
  middleware.ts

lib/
  supabase/{server.ts, client.ts}
  notion/{client.ts, write.ts, read.ts, format.ts}
  claude/{client.ts, classify.ts, dedup.ts, summarize.ts, prompts/}
  pipeline/{ingest.ts, followup.ts, undo.ts}
  db/{schema.ts, queries.ts}
  types.ts

components/
  capture/{MicButton.tsx, TranscriptEditor.tsx, CaptureForm.tsx}
  entries/{EntryCard.tsx, DestinationBadge.tsx, EntryList.tsx}
  taxonomy/CategoryTree.tsx

supabase/migrations/*.sql
scripts/seed-taxonomy.ts              -- one-time: creates starter Notion structure + seeds Postgres
vercel.json                           -- cron config
```

`lib/pipeline/ingest.ts` is the single orchestration function the API route calls - keeps classify → route → write → log testable independent of HTTP.

---

## 13. Phased roadmap

### Phase 1 - true MVP
- Auth, capture page (voice + text, editable transcript before submit)
- Seed taxonomy created in Notion + Postgres via `seed-taxonomy.ts`
- Multi-destination classification against the live tree (no dynamic creation yet)
- Simple Notion writes: row create for banks, end-of-page append for documents
- Entry log recorded in Postgres with a basic list UI
- **Cut:** dedup, undo, follow-ups, dynamic taxonomy, background retries

### Phase 2 - organized filing + audit
- LLM-formatted content (not raw transcript dumps)
- Section-aware document appends (`after` block insertion)
- Visible undo (archive/delete) + reassign
- Background retry queue via Vercel Cron
- Entry log filters/search; "created new" badge UI scaffolded

### Phase 3 - semantic dedup + dynamic taxonomy
- Live-fetch dedup for `dedup_enabled` destinations, merge-with-snapshot writes
- Dynamic node creation at any tree depth, with full undo
- Auto-maintained destination summaries
- Prompt-cache the taxonomy block

### Phase 4 - follow-up context
- Recent-entry reference resolution, adjacent-block follow-up appends
- "Referring to…" UI confirmation + manual override

### Phase 5 - polish / scale
- Per-client privacy separation via Notion-level page sharing scoping
- iOS voice UX polish, auto-send toggle
- Cost/usage dashboard from `classification_runs`
- Embeddings/vector search only if a bank becomes genuinely unwieldy

---

## 14. Risks & mitigations

1. **Notion API rate limits** (~3 req/s sustained) - low risk at personal volume; minimal reads by design, retry/backoff via `job_queue`.
2. **Web Speech API on iOS Safari** - real limitation; text input is the first-class fallback, and transcription is swappable later without touching the pipeline.
3. **Transcription accuracy** - mandatory editable-transcript step before anything is filed.
4. **Model quality vs cost** - Haiku 4.5 default, env-var configurable; test routing quality early and bump if needed.
5. **Partial multi-destination failures** - `partial_error` status, per-destination state in the UI, never all-or-nothing.
6. **Category sprawl** from auto-creation - high visibility + one-tap merge/undo; monitor.
7. **Notion structure drift** - heading-based section detection falls back to end-of-page + warning flag, never a silent misfile.
8. **Merge-undo correctness** - `before_content` snapshotting is mandatory from the first day dedup ships; without it, undoing a merge is destructive.
9. **Vercel function timeout** - expected fine for these call shapes; measure real latency early, especially multi-destination + new-category entries.
10. **LLM routing non-determinism** - mitigated by full raw-response logging (`classification_runs`) and cheap reassign, not chased via determinism tricks.
11. **Client-work privacy if ever shared** - client destinations live under separate Notion parent pages, so Notion-level sharing scoping is available later without rearchitecting; no multi-tenant auth is being built now.

---

## 15. What building Phase 1 requires (setup checklist)

1. Supabase project - run the migration in §5, enable magic-link auth, note the URL + anon key + service-role key.
2. Notion internal integration - create at notion.so/my-integrations, copy the token.
3. Notion `🧠 Second Brain` page - create manually, share it with the integration.
4. Anthropic API key.
5. Vercel project linked to the repo with all of the above as env vars (`ANTHROPIC_MODEL=claude-haiku-4-5`).
6. Run `scripts/seed-taxonomy.ts` once to create the starter structure in both Notion and Postgres. **Superseded by §16:** the structure is now built from `/setup` with no terminal.

---

## 16. In-app setup

Steps 1 to 5 above are unavoidable: they are accounts and secrets, and secrets stay in env vars. Everything after them now happens inside the app, so a friend who can follow a web page can get from a fresh deploy to a working install with no code editor and no terminal.

### Account

Covered in §11. Zero users means `/login` offers account creation once, and `POST /api/setup/account` re-checks the same condition as its only guard. The middleware exempts that one path by exact match, so nothing added under `/api/setup` later inherits the exemption.

### Taxonomy creation (`/setup`, `lib/setup/build-taxonomy.ts`)

The old wall was `scripts/seed-taxonomy.ts`: a non-coder had to open a TypeScript file, rewrite an example tree, and run `npm run seed`, and nothing downstream was reachable until they did.

The replacement is a three-step flow:

1. **Describe.** The user writes a paragraph or two about their life and work. `lib/claude/propose-taxonomy.ts` turns it into a proposed tree via one structured-output call: categories with routing descriptions, and typed destinations under each. The proposal is normalized before it reaches the UI (unique keys, no dangling or cyclic parents, depth cap, exactly one catch-all) so a bad generation can never render as an empty or looping tree.
2. **Edit.** Rename, delete, add, re-parent, switch a destination between `bank_database` and `document_section`, toggle dedup, set a document's section heading, and rewrite every description. Descriptions get the most emphasis in the copy because they are the only thing the classifier reads. Regenerating with free-text feedback is available and replaces the whole tree.
3. **Build.** `buildTaxonomy()` creates a container page per category (nested per parent), a database per bank, and a childless page per document, then inserts the matching `categories`/`destinations` rows, then runs `runNotionSync()`.

The Notion mapping is chosen so the sync in §6 reads the result back unchanged: a page with children is a category, a childless page is a document destination, a database is a bank. That is why a category with no destinations and no children is rejected at validation - it would create a bare page that a later sync would import as a document destination the classifier then files real thoughts into.

Two invariants worth stating:

- **The catch-all keeps the slug `general-notes`,** whatever the user names it. `CATCH_ALL_SLUG` is exported from `lib/setup/build-taxonomy.ts` and consumed by the ingest pipeline; validation refuses a plan without exactly one catch-all.
- **The build is all-or-nothing.** A failure part way through trashes the Notion pages created so far (top-level pages only; Notion takes the subtree with them) and deletes the inserted rows, then rethrows. Without that, `assertBuildable` would refuse the retry while half a structure sat in Notion. Pages go to Notion's trash, never hard-deleted.

`assertBuildable` refuses when any active destination already exists. Building on top of an existing taxonomy is what the Sync button is for, and the copy says so in both the API error and the Setup page.

### Health check (`lib/setup/health.ts`, `/api/health`)

Every credential failure used to surface as a raw API error mid-capture, or as silence. The health panel probes each dependency and pairs every failure with the exact remedy: required env vars, all twelve schema tables, the Notion token, the root page, the Anthropic key and model, Voyage, the taxonomy itself, ClickUp, and the production-only settings. Each check owns its own failure, and nothing throws.

The one that earns its own paragraph: **Notion answers 404 for a page that exists but has not been shared with the integration**, which is indistinguishable from a wrong page ID. That is the single most common setup failure and the error text is actively misleading, so the remedy names the "page menu, Connections, add your integration" step explicitly and puts it first, before questioning the ID. A 401 on the same check reports that the token is the problem rather than sending the user to re-share a page.

### Empty states

With an empty taxonomy the capture form can only fail, so `/` shows the setup card in its place rather than a box that cannot work, `WorkspaceGrid` renders the same card instead of nothing, and the ingest error names the Setup page instead of `npm run seed`.
