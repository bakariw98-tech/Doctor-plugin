# Creator Picks MCP App

An [MCP App](https://modelcontextprotocol.io/extensions/apps) (the open
standard that ChatGPT's Apps SDK is built on) that answers the question a
creator's audience actually asks — *"what do you use for this?"* — with the
creator's own curated pick and a link to buy it.

Someone asks "what knife do you use for everyday cooking" or "what do you
use to stay lean." The plugin answers with the product, a short line in the
creator's own words about why they use it and who it's for, and a **Get it**
button that goes straight to the purchase link.

There is no email gate, no free guide, and nothing collected from the person
asking. The recommendation and the purchase link are the entire payoff,
delivered the moment they ask.

It works as a remote MCP server, so it can be added as a connector in any
MCP-Apps-capable host (Claude, ChatGPT, etc.).

## What it does and doesn't do

- **It never comes up empty.** If someone asks about something the catalog
  doesn't cover, the tool still returns the closest real thing and flags the
  match as weak — so the model says plainly that there's no specific pick and
  steers to something the creator actually uses ("he doesn't have a pan he
  recommends, but he does swear by this knife for prep") instead of either
  inventing a product or saying "I don't know."
- **It never invents a product, a reason, or a price.** Everything the model
  speaks comes from the catalog. The blurb on each card is the creator's own
  words, written by them in `/admin`, and nothing is generated for them.
- **Every unanswered question is recorded.** A question with no good match is
  the most valuable row in the database: it's a product the audience already
  wants and the creator isn't recommending yet. `/admin` surfaces those as a
  gap list.

## How it works

- **`src/mcp-server.ts`** — builds the MCP server. Two tools:
  `recommend_product` (the main one — takes the person's question verbatim,
  returns the pick plus a tracked buy link) and `list_recommendations` (browse
  a category, for "what does he recommend for the kitchen"). Both are linked
  to the UI resource via `_meta.ui.resourceUri` and the
  `openai/outputTemplate` alias, for ChatGPT's Apps SDK.
- **`src/recommend.ts`** — turning a question into a pick, shared by the MCP
  tool and the REST endpoint so the browser preview exercises the same
  matching the real thing does.
- **`src/match.ts`** — the matcher. TF-IDF-style scoring over the catalog, so
  a rare, specific word ("creatine") outweighs one that appears across every
  product. No embeddings, no external service: a catalog is small enough to
  scan per request. It also reports what *share* of the question it matched,
  which is what separates a real answer from a steer.
- **`src/db.ts`** — the Postgres client (the plain
  [`postgres`](https://github.com/porsager/postgres) driver against a
  [Supabase](https://supabase.com) connection string). Owns the schema
  (`products`, `product_questions`, `product_clicks`) and creates it
  idempotently on first use.
- **`src/admin.ts`** — the `/admin` dashboard: catalog CRUD, a bulk import for
  pasting an existing affiliate list, and the insight panel (most-asked
  questions, the gap list, clicks per product). Plain server-rendered HTML
  behind a shared-token cookie (`ADMIN_TOKEN`).
- **`api/redirect.ts`** — `GET /r/<productId>?q=<questionId>`: counts the
  click, then redirects to the stored buy link. The destination is always
  looked up by id and never read from the request, so this can't be used as
  an open redirect.
- **`mcp-app.html` / `src/mcp-app.ts` / `src/product-card.ts`** — the widget
  that renders inside a chat host, and the card rendering it shares with the
  demo page. Two densities across four layouts — see `design/README.md`.
- **`index.html` / `src/demo.ts`** — a standalone browser demo (talking to
  `/api/recommend` instead of the MCP bridge, with a question box and a
  view dropdown since there's no chat agent here to supply either), deployed
  at the site root so it's testable without a chat client.
- **`server.ts`** — local dev entry point: Express serving `/mcp`,
  `/api/recommend`, `/r/:id`, `/admin` and the static demo page from one
  process. **`api/*.ts`** are the same endpoints as Vercel serverless
  functions, used in production.

## Setup

### 1. Create a Supabase project

At [supabase.com](https://supabase.com) — free tier is fine. This is a
manual, one-time step; nothing in this repo can do it for you.

Copy `.env.example` to `.env` and fill in `DATABASE_URL` and `ADMIN_TOKEN`
(see that file for exactly where each value comes from).

```bash
cp .env.example .env
# then edit .env
```

**Just want to see it work first?** Set `DEMO_MODE=1` and skip straight to
step 2 — everything runs against an in-process store instead of Postgres.
Nothing is saved (it resets on restart), so this is for previewing the flow
only.

### 2. Install, build, and run

```bash
npm install
npm run build   # bundles the widget (dist/) and demo page (public/)
npm run serve   # starts the server: /mcp, /api/recommend, /r/:id, /admin
```

(`npm run dev` does both in one step.) Open `http://localhost:3001/` for the
browser demo, `http://localhost:3001/admin` to fill in your catalog, or point
a chat client at `http://localhost:3001/mcp`.

### 3. Fill in the catalog

Visit `/admin`, log in with your `ADMIN_TOKEN`, and add what you recommend.
Each product takes a name, a buy link, and — the part that matters — **your
own line about why you use it**, which is what the card shows and what the
model speaks. Nothing is written for you.

If you already have an affiliate list (Amazon storefront, LTK, a notes file),
paste it into the **Import a list** box: one URL per line, or
`name, url, category`. Everything imports as a draft with no description, and
drafts are never recommended — so an unfinished import can't produce a
recommendation with no words behind it. Write your line, hit publish.

### Optional: product photo uploads

Set `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` (see `.env.example`) to let
`/admin` upload photos directly. This needs a one-time public storage bucket,
created from the Supabase SQL editor:

```sql
insert into storage.buckets (id, name, public)
values ('product-images', 'product-images', true)
on conflict (id) do nothing;

create policy "public read product-images" on storage.objects
  for select using (bucket_id = 'product-images');
```

Uploading is the recommended path rather than pasting a merchant's image URL:
the widget's CSP allowlist is fixed when the resource is registered and can't
enumerate every retailer CDN, so a pasted URL from an unlisted host renders
blank with no error. Routing every photo through one bucket means one origin
on the allowlist.

## Deploying to Vercel

The repo deploys as-is (`vercel.json` wires the build + serverless functions):
`npm run build` runs as the build command, `public/index.html` becomes the
site root, and `api/mcp.ts` / `api/recommend.ts` / `api/admin.ts` /
`api/redirect.ts` become functions at `/api/mcp` (also `/mcp`),
`/api/recommend`, `/api/admin` (also `/admin`), and `/r/:id`.

**Environment variables are per-platform** — GitHub repo secrets are not
visible to Vercel. Set `DATABASE_URL` and `ADMIN_TOKEN` (plus the two Supabase
storage vars if you want uploads) under the Vercel project's **Settings →
Environment Variables**, then redeploy. Env var changes don't take effect
until the next deploy.

Once deployed:

- Visit the deployment URL for the live browser demo.
- Use `https://<your-deployment>.vercel.app/mcp` as the connector URL in
  Claude or ChatGPT developer mode.

## Upgrading from the lead-capture version

Earlier versions of this app searched a YouTube channel and offered a free
guide in exchange for an email. All of that is gone: `search_doctor_videos`,
`offer_lead_magnet`, `submit_lead`, the transcript dataset, the YouTube API
client, and the `leads` / `lead_magnet_config` / `lead_form_questions` tables.

Those three tables are **not** dropped automatically — a deploy that silently
destroyed a collected email list would be unrecoverable. Retire them
deliberately, in two steps:

```bash
npm run retire-leads            # exports every lead to leads-export.csv
# check the file, then:
npm run retire-leads -- --drop  # drops the three tables
```

You can also drop `YOUTUBE_API_KEY`, `YOUTUBE_CHANNEL_ID`,
`YOUTUBE_CHANNEL_HANDLE` and `SUPADATA_API_KEY` from `.env` and from Vercel —
nothing reads them any more.

## Testing it in a chat client

MCP Apps need a host that understands the UI extension.

**Claude (web/desktop):** add your deployment's `/mcp` URL (or a tunneled
local server, e.g. `npx cloudflared tunnel --url http://localhost:3001`) as a
[custom connector](https://support.anthropic.com/en/articles/11175166-getting-started-with-custom-connectors-using-remote-mcp)
under Settings → Connectors. Then ask it what the creator uses for something.

**ChatGPT (developer mode):** enable developer mode, add the same URL as a
connector, and ask the same kind of question — ChatGPT will call
`recommend_product` and render the widget via the `openai/outputTemplate` link.

**Local basic-host:** the
[`ext-apps`](https://github.com/modelcontextprotocol/ext-apps) repo ships a
minimal test host if you'd rather not tunnel anything while iterating on the
widget UI.

## Next steps / ideas

- Let a product carry more than one buy link (different retailers/regions).
- Track which questions convert best per product, not just totals.
- A "what's new" tool for recently added recommendations.
