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
  full descriptions/tags (`src/youtube.ts`) and, for the top few, an actual
  transcript when one's available (`src/transcript.ts`), and returns it all
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
- **`src/transcript.ts`** — optional: fetches the actual spoken-content
  transcript for the top few results via [Supadata](https://supadata.ai),
  native-captions only (never AI-generated — see the file for why). Gives
  the model real content to judge fit and speak from, not just metadata.
- **`scripts/embed-widget.mjs`** — inlines the built `dist/mcp-app.html`
  into `src/generated/widget-html.ts` so the server can import it directly
  (a plain `fs.readFile` at request time isn't reliable in a serverless
  bundle).

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
- `SUPADATA_API_KEY` — optional. Without it, everything works, just without
  transcripts. See `.env.example` for where to get one and what it costs.

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

## Deploying to Vercel

The repo deploys as-is (`vercel.json` wires the build + serverless
functions): `npm run build` runs as the Vercel build command,
`public/index.html` becomes the site root, and `api/mcp.ts` / `api/search.ts`
become serverless functions at `/api/mcp` (also reachable at `/mcp`) and
`/api/search`.

**Environment variables are per-platform** — GitHub repo secrets are not
visible to Vercel. Set `YOUTUBE_API_KEY`, either `YOUTUBE_CHANNEL_ID` or
`YOUTUBE_CHANNEL_HANDLE`, and optionally `SUPADATA_API_KEY` under the Vercel
project's **Settings → Environment Variables**, then redeploy.

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
- Pre-fetch/cache transcripts for the whole catalog ahead of time (needs
  persistent storage — Vercel functions are stateless) instead of fetching
  live per search, if per-query Supadata latency/cost becomes a problem.
