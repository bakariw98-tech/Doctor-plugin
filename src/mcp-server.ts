// src/mcp-server.ts
// Builds a configured McpServer instance. Shared by the local dev server
// (server.ts, Express + long-lived process) and the Vercel serverless
// function (api/mcp.ts, one instance per request) so both stay in sync.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  registerAppTool,
  registerAppResource,
  RESOURCE_MIME_TYPE,
} from "@modelcontextprotocol/ext-apps/server";
import { z } from "zod";
import { searchChannelVideos, getVideosByIds, type VideoResult } from "./youtube.js";
import { findTranscriptMatches } from "./transcript-search.js";
import { resolveView } from "./view.js";
import { WIDGET_HTML } from "./generated/widget-html.js";
import { TRANSCRIPTS } from "./generated/transcripts.js";

// How many locally-matched (by transcript content) videos can be boosted
// into a response ahead of YouTube's own keyword-ranked results.
const MAX_TRANSCRIPT_BOOSTED = 3;

// The ui:// scheme tells hosts this is an MCP App resource. The path
// structure is arbitrary; it just needs to match the tool's outputTemplate.
export const RESOURCE_URI = "ui://search-doctor-videos/mcp-app.html";

// Total transcript characters allowed in one response, across every video
// returned. Each stored transcript can run up to 15000 chars on its own
// (see TRANSCRIPT_LIMIT in transcript.ts) — fine for one video, but
// maxResults defaults to 8, and several long transcripts in the same
// response could push past what a host is willing to accept in a single
// tool result. This budget is shared out below rather than applied as a
// flat per-video cap, so a search that surfaces one long relevant video
// alongside several short ones doesn't truncate the one that matters just
// because of a fixed per-video ceiling.
const TOTAL_TRANSCRIPT_BUDGET = 24000;

// Some MCP hosts only feed the model this tool's `content` text — the
// structured `structuredContent.videos` (full description, tags,
// transcript) is delivered to the widget's iframe, not necessarily back
// into the model's own context. So the actual reasoning material has to
// live here too, or the model is answering blind: it'll see thumbnails on
// screen but have no idea what's actually in them. Confirmed live against
// Claude's web connector, which never saw a transcript that was only in
// structuredContent.
function buildResultText(query: string, videos: VideoResult[]): string {
  if (videos.length === 0) {
    return `No videos found about "${query}" on this channel. Try a different search term.`;
  }

  // Give every video an equal share of the total budget first; a video
  // with a shorter transcript (or none) leaves its unused share for the
  // others, distributed evenly across whoever still has more to give.
  const lengths = videos.map((v) => v.transcript?.length ?? 0);
  let remainingBudget = TOTAL_TRANSCRIPT_BUDGET;
  let remainingVideos = videos.length;
  const allotted = lengths.map((len) => {
    const share = Math.floor(remainingBudget / remainingVideos);
    const used = Math.min(len, share);
    remainingBudget -= used;
    remainingVideos -= 1;
    return used;
  });

  const entries = videos.map((v, i) => {
    const lines = [`"${v.title}" (${v.duration ?? "?"}, published ${v.publishedAt.slice(0, 10)})`];
    if (v.description) lines.push(`Description: ${v.description}`);
    if (v.tags?.length) lines.push(`Tags: ${v.tags.join(", ")}`);
    if (v.transcript) {
      const cap = allotted[i];
      const shown = v.transcript.slice(0, cap);
      const truncatedNote =
        cap < v.transcript.length
          ? " [cut off here to fit this reply — there is more transcript after this point that " +
            "isn't shown; say so rather than guessing about anything past it]"
          : "";
      lines.push(
        `Transcript (has '[MM:SS]' markers roughly every 20s — cite the nearest one when the ` +
          `answer is specific): ${shown}${truncatedNote}`,
      );
    } else {
      lines.push("Transcript: not available for this video.");
    }
    return lines.join("\n");
  });

  return (
    `${videos.length} video${videos.length === 1 ? "" : "s"} about "${query}":\n\n` +
    entries.join("\n\n---\n\n")
  );
}

export function createMcpServer(): McpServer {
  const server = new McpServer({
    name: "Doctor YouTube Search",
    version: "1.0.0",
  });

  registerAppTool(
    server,
    "search_doctor_videos",
    {
      title: "Search Doctor Videos",
      description:
        "Searches the configured doctor's YouTube channel for videos matching a symptom, topic, or " +
          "question, using YouTube's own keyword search as a first pass, plus a second pass that " +
          "searches the actual spoken content of every locally-transcribed video (YouTube's own " +
          "search never does this — it only indexes title/description/tags) and surfaces any real " +
          "content match first, ahead of the keyword-ranked results, even if its title shares no " +
          "words with the question. Each result comes back with its full, untruncated video " +
          "description (not the ~130-character snippet YouTube's search API normally returns) and " +
          "its tags, on top of title/duration/publishedAt — read that full description and tags " +
          "yourself and use your own judgment about which result(s) actually answer the question, " +
          "since keyword ranking alone can surface a video that mentions the right words in passing " +
          "over one that's actually about the topic, or miss one that's conceptually relevant but " +
          "phrased differently. If the closest keyword match doesn't really fit, say so and point to " +
          "whichever one does, rather than defaulting to result order. For a specific, answerable " +
          "question (not a broad topic browse), your job is to converge on the ONE video that " +
          "actually answers it, using its transcript to confirm — don't just hand back a pile of " +
          "results and make the person figure it out. When you're confident which single video " +
          "answers it, call this tool again with maxResults: 1 and that video's exact title as the " +
          "query, so the widget shows just that one thumbnail instead of a whole set. When " +
          "a transcript is present (from a pre-built local dataset covering the channel's recent " +
          "uploads — not every video has one, and very new videos may not be in it yet), it's the " +
          "actual spoken content and is far more reliable for judging fit than the description or " +
          "title; prefer it when deciding which video to recommend and when describing what a video " +
          "actually covers. The transcript has inline '[MM:SS]' markers dropped in roughly every 20 " +
          "seconds of the video — when a question is specific enough that one moment answers it (e.g. " +
          "'how much protein does he say to eat a day'), search the transcript for that answer and " +
          "tell the person the approximate timestamp where it's said ('around 4:20 he says...'), not " +
          "just that the video covers the topic. There's no timestamped link to give them — say the " +
          "time in words so they can skip to it themselves. The " +
          "rendered widget shows thumbnails only — no titles, dates, or descriptions are drawn on " +
          "screen. So after calling this, speak the results yourself in your reply using what you " +
          "read: say which one you'd start with and why, and note runtime when it's relevant to " +
          "picking (a 20-second clip vs. a 10-minute breakdown). Don't just report a count — the " +
          "thumbnails carry no information on their own without your reply.",
      inputSchema: {
        query: z
          .string()
          .describe("Symptom, topic, or question to search the channel for, e.g. 'lower back pain'."),
        maxResults: z
          .number()
          .int()
          .min(1)
          .max(20)
          .optional()
          .describe("How many videos to return (default 8, max 20)."),
        view: z
          .enum(["auto", "card", "spotlight", "carousel", "grid"])
          .optional()
          .describe(
            "Layout for the results. 'card' is one large detail card (best for a single top match); " +
              "'spotlight' is a stacked list with a description snippet per video (best for a small " +
              "number of best matches); 'carousel' is a horizontal scroller (best for browsing many " +
              "matches); 'grid' is a wrapping grid, normally only reached via the widget's own " +
              "fullscreen affordance. 'auto' (default) picks card for 1 result, spotlight for 2-3, " +
              "and carousel for more.",
          ),
      },
      _meta: {
        ui: { resourceUri: RESOURCE_URI },
        // ChatGPT (Apps SDK) compatibility alias for the same resource link.
        "openai/outputTemplate": RESOURCE_URI,
        "openai/toolInvocation/invoking": "Searching the channel…",
        "openai/toolInvocation/invoked": "Here's what I found.",
      },
    },
    async ({ query, maxResults, view }) => {
      try {
        const limit = maxResults ?? 8;
        const videos = await searchChannelVideos(query, limit);

        // Local transcript search: catches a video whose spoken content
        // actually answers the question even when its title/description/
        // tags don't share any of the query's words — something YouTube's
        // own search.list can never do, since it doesn't index speech at
        // all. Any match not already in the keyword-search results gets
        // fetched and prepended, so a content-verified answer surfaces
        // even when keyword ranking alone would have missed or buried it.
        const existingIds = new Set(videos.map((v) => v.videoId));
        const localMatches = findTranscriptMatches(query, TRANSCRIPTS, MAX_TRANSCRIPT_BOOSTED).filter(
          (m) => !existingIds.has(m.videoId),
        );
        let boosted: VideoResult[] = [];
        if (localMatches.length > 0) {
          try {
            boosted = await getVideosByIds(localMatches.map((m) => m.videoId));
          } catch {
            // Best-effort — the keyword-search results alone are still a
            // fine response if this fails.
          }
        }

        const combined = [...boosted, ...videos].slice(0, limit);

        // Local lookup only — no network call, no Supadata dependency at
        // request time. TRANSCRIPTS is a pre-built dataset embedded at
        // build time (see scripts/fetch-transcripts.ts and
        // scripts/embed-transcripts.mjs); a video not in it just has no
        // transcript, same as any other optional field.
        for (const video of combined) {
          const transcript = TRANSCRIPTS[video.videoId];
          if (transcript) video.transcript = transcript;
        }

        const resolvedView = resolveView(view, combined.length);

        return {
          content: [{ type: "text", text: buildResultText(query, combined) }],
          structuredContent: { query, view: resolvedView, videos: combined },
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text", text: `Search failed: ${message}` }],
          isError: true,
        };
      }
    },
  );

  registerAppResource(
    server,
    "Doctor Video Search",
    RESOURCE_URI,
    { mimeType: RESOURCE_MIME_TYPE },
    async () => ({
      contents: [
        {
          uri: RESOURCE_URI,
          mimeType: RESOURCE_MIME_TYPE,
          text: WIDGET_HTML,
          _meta: {
            ui: {
              // No video embed (no frameDomains needed) — tapping a video
              // always opens it externally via app.openLink instead of
              // playing inline, so there's no iframe CSP to fight across
              // hosts. resourceDomains covers the YouTube thumbnail images.
              csp: {
                resourceDomains: ["https://i.ytimg.com"],
              },
            },
          },
        },
      ],
    }),
  );

  return server;
}
