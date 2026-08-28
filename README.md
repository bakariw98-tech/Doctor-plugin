# Doctor YouTube MCP App

An [MCP App](https://modelcontextprotocol.io/extensions/apps) (the open
standard that ChatGPT's Apps SDK is built on) that searches a single doctor's
YouTube channel and renders the matching videos as a scrollable carousel
inline in the chat. Tapping a thumbnail plays the video right there in an
embedded YouTube player (with picture-in-picture available via the player's
own controls, browser support permitting) — no leaving the conversation.

It works as a remote MCP server, so it can be added as a connector in any
MCP-Apps-capable host (Claude, ChatGPT, etc.).

## How it works

- **`server.ts`** — an MCP server (TypeScript SDK) exposing one tool,
  `search_doctor_videos`, which calls the YouTube Data API v3 scoped to a
  single configured channel and returns the results as `structuredContent`.
  The tool is linked to a UI resource via `_meta.ui.resourceUri` (and the
  `openai/outputTemplate` alias, for ChatGPT's Apps SDK).
- **`mcp-app.html` / `src/mcp-app.ts`** — the carousel widget. It reads the
  tool's structured output, renders one card per video, and swaps a card's
  thumbnail for a live YouTube `<iframe>` embed on click. It also has its
  own search box that calls the tool again directly from the widget.
- **`src/youtube.ts`** — the YouTube Data API client: resolves the
  configured channel, runs `search.list` scoped to it, and enriches results
  with duration via `videos.list`.

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

```bash
cp .env.example .env
# then edit .env
```

### 3. Install, build, and run

```bash
npm install
npm run build   # bundles the widget into dist/mcp-app.html
npm run serve   # starts the MCP server on http://localhost:3001/mcp
```

(`npm run dev` does both in one step.)

## Testing it

MCP Apps need a host that understands the UI extension. Two easy options:

**Claude (web/desktop):** tunnel your local server, e.g.

```bash
npx cloudflared tunnel --url http://localhost:3001
```

then add the printed `https://...trycloudflare.com` URL as a
[custom connector](https://support.anthropic.com/en/articles/11175166-getting-started-with-custom-connectors-using-remote-mcp)
in Claude (Settings → Connectors → Add custom connector — append `/mcp` to
the tunnel URL). Ask Claude to search the channel for a topic.

**ChatGPT (developer mode):** enable developer mode, add the same tunnel URL
as a connector, and ask about a topic covered on the channel — ChatGPT will
call `search_doctor_videos` and render the carousel via the
`openai/outputTemplate` link.

**Local basic-host:** the
[`ext-apps`](https://github.com/modelcontextprotocol/ext-apps) repo ships a
minimal test host if you'd rather not tunnel anything while iterating on the
widget UI.

## Notes on picture-in-picture

The embedded player is a standard YouTube iframe with
`allow="picture-in-picture"`. Whether a floating PiP window is available
depends on the browser and the host's iframe sandboxing — Chrome and Edge
generally expose it via the video's own controls; Safari and some embedded
webviews may not. There's no separate app code needed for this — it's the
browser's native PiP acting on the YouTube player.

## Next steps / ideas

- Cache `search.list` results briefly to stay well under YouTube's daily
  quota if the channel gets heavy traffic.
- Add a `list_recent_videos` tool (no query) for "what's new on the channel"
  style requests.
- Filter by playlist if the doctor organizes videos by condition/topic.
