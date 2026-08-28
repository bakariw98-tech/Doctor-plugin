# Doctor YouTube MCP App

An [MCP App](https://modelcontextprotocol.io/extensions/apps) (the open
standard that ChatGPT's Apps SDK is built on) that searches a single doctor's
YouTube channel for videos matching what you asked, and hands you thumbnails
to tap. Tapping one opens it on YouTube.

The design deliberately keeps the widget to just thumbnails — no titles,
dates, or descriptions drawn on screen. That's the model's job: it reads the
full video data (description, tags, and — when available — an actual
transcript) and speaks the results itself in its reply, the same way it
would if you'd asked a person who'd watched the channel. See
`design/README.md` for the reasoning.

It works as a remote MCP server, so it can be added as a connector in any
MCP-Apps-capable host (Claude, ChatGPT, etc.).

## How it works

- **`src/mcp-server.ts`** — builds the MCP server: one tool,
  `search_doctor_videos`, which searches the channel, enriches results with
  full descriptions/tags (`src/youtube.ts`), and looks up a transcript for
  each from a local pre-built dataset when one exists, then returns it all
  as `structuredContent` for the model to reason over and speak from. The
  tool is linked to a UI resource via `_meta.ui.resourceUri` (and the
  `openai/outputTemplate` alias, for ChatGPT's Apps SDK).
- **`server.ts`** — local dev entry point: Express serving `/mcp`,
  `/api/search`, and the static demo page from one process.
- **`api/mcp.ts`** / **`api/search.ts`** — the same two endpoints as Vercel
  serverless functions, used in production.
- **`mcp-app.html` / `src/mcp-app.ts`** — the widget that renders inside a
  chat host: thumbnails only, one shared layout component used across all
  four view modes (`src/view.ts`), plus a fullscreen "view all" affordance
  for large result sets. No search box in the widget — the chat is already
  the search box.
- **`index.html` / `src/demo.ts`** — a standalone browser demo of the same
  thumbnails (talking to `/api/search` instead of the MCP bridge, with a
  search box and view-mode dropdown since there's no chat agent here to
  supply either), built to `public/index.html` and deployed at the site
  root so it's testable without a chat client.
- **`src/carousel.ts`** — the rendering logic shared by the widget and the
  demo page: one `renderThumb` (image + duration chip + hover play cue)
  reused across all four containers, so what you see in the browser preview
  matches what renders in chat.
- **`src/youtube.ts`** — the YouTube Data API client: resolves the
  configured channel, runs `search.list` for the initial keyword-ranked
  candidates, then a second `videos.list` pass for each (full untruncated
  description, tags, duration — `search.list`'s own description field is
  truncated to ~130 characters).
- **`scripts/fetch-transcripts.ts`** — an offline, manually-run script
  (`npm run fetch-transcripts`) that pulls actual spoken-content
  transcripts for the channel's videos via [Supadata](https://supadata.ai)
  (native-captions only, never AI-generated) and writes them to
  `data/transcripts.json`. **This is not called by the running app** — the
  deployed server has no Supadata dependency at request time; it only
  reads the dataset this script produced. See the file for the reasoning
  (mainly: an app under review shouldn't depend on a live third-party API
  it doesn't need to).
- **`src/transcript.ts`** — the Supadata client the script above uses
  (fetch + retry/timeout handling + per-video caching so re-running the
  script doesn't re-pay for videos it's already checked).
- **`scripts/embed-widget.mjs`** / **`scripts/embed-transcripts.mjs`** —
  inline the built `dist/mcp-app.html` and `data/transcripts.json` into
  `src/generated/*.ts` modules the server imports directly, since a plain
  `fs.readFile` at request time isn't reliable in a serverless bundle.

## Setup

### 1. Get a YouTube Data API key

1. Create (or pick) a project in the
   [Google Cloud Console](https://console.cloud.google.com/).
2. Enable **YouTube Data API v3** for that project.
3. Create an API key under **APIs & Services → Credentials**.

### 2. Point it at the doctor's channel

Copy `.env.example` to `.env` and fill in:

- `YOUTUBE_API_KEY` — the key from step 1.
- `YOUTUBE_CHANNEL_ID` — the channel's ID (starts with `UC...`), **or**
  `YOUTUBE_CHANNEL_HANDLE` — the channel's public `@handle` if you don't have
  the ID handy. Only one of the two is needed.
- `SUPADATA_API_KEY` — optional, and only for the offline
  `npm run fetch-transcripts` step below, not the running server. See
  `.env.example` for where to get one and what it costs.

```bash
cp .env.example .env
# then edit .env
```

### 3. Install, build, and run

```bash
npm install
npm run build   # bundles the widget (dist/) and demo page (public/)
npm run serve   # starts the server: /mcp, /api/search, and the demo page
```

(`npm run dev` does both in one step.) Open `http://localhost:3001/` for the
browser demo, or point a chat client at `http://localhost:3001/mcp`.

### Optional: build the transcript dataset

The server can speak from a video's actual transcript, not just its title
and description — but only if that transcript has already been fetched
offline and committed. This is a separate, manual step, not something the
running app does for you:

```bash
npm run fetch-transcripts          # up to 100 of the channel's videos
npm run fetch-transcripts -- 30    # or a smaller number, e.g. while testing
```

This reads `SUPADATA_API_KEY` from `.env`, lists the channel's uploads, and
writes `data/transcripts.json` — skipping any video already in that file,
so it's safe to re-run later (e.g. after the channel publishes new videos)
without re-spending credits on ones it's already checked. Then:

```bash
npm run build   # embeds data/transcripts.json into src/generated/transcripts.ts
git add data/transcripts.json
git commit -m "Update transcript dataset"
git push         # redeploys automatically if Vercel is git-linked (see below)
```

`SUPADATA_API_KEY` never needs to be set anywhere the app actually
runs (locally via `npm run serve`, or on Vercel) — it's only read by the
`fetch-transcripts` script itself.

## Deploying to Vercel

The repo deploys as-is (`vercel.json` wires the build + serverless
functions): `npm run build` runs as the Vercel build command,
`public/index.html` becomes the site root, and `api/mcp.ts` / `api/search.ts`
become serverless functions at `/api/mcp` (also reachable at `/mcp`) and
`/api/search`.

**Environment variables are per-platform** — GitHub repo secrets are not
visible to Vercel. Set `YOUTUBE_API_KEY` and either `YOUTUBE_CHANNEL_ID` or
`YOUTUBE_CHANNEL_HANDLE` under the Vercel project's **Settings →
Environment Variables**, then redeploy. Don't set `SUPADATA_API_KEY` there
— the deployed app never reads it; it's only used locally by
`npm run fetch-transcripts` (above) to build `data/transcripts.json`, which
gets committed and deployed like any other file.

Once deployed:

- Visit the deployment URL for the live browser demo (search + thumbnails,
  no chat client needed).
- Use `https://<your-deployment>.vercel.app/mcp` as the connector URL in
  Claude or ChatGPT developer mode.

## Testing it in a chat client

MCP Apps need a host that understands the UI extension. Two easy options:

**Claude (web/desktop):** add your Vercel deployment's `/mcp` URL (or a
tunneled local server, e.g. `npx cloudflared tunnel --url http://localhost:3001`)
as a
[custom connector](https://support.anthropic.com/en/articles/11175166-getting-started-with-custom-connectors-using-remote-mcp)
in Claude (Settings → Connectors → Add custom connector). Ask Claude to
search the channel for a topic.

**ChatGPT (developer mode):** enable developer mode, add the same URL as a
connector, and ask about a topic covered on the channel — ChatGPT will call
`search_doctor_videos` and render the widget via the `openai/outputTemplate`
link.

**Local basic-host:** the
[`ext-apps`](https://github.com/modelcontextprotocol/ext-apps) repo ships a
minimal test host if you'd rather not tunnel anything while iterating on the
widget UI.

## Next steps / ideas

- Cache `search.list` results briefly to stay well under YouTube's daily
  quota if the channel gets heavy traffic.
- Add a `list_recent_videos` tool (no query) for "what's new on the channel"
  style requests.
- Filter by playlist if the doctor organizes videos by condition/topic.
- Re-run `npm run fetch-transcripts` periodically (e.g. after the channel
  publishes new videos) and commit the updated `data/transcripts.json` —
  there's no automation for this yet, it's a manual step.
