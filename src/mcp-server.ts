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
import { searchChannelVideos } from "./youtube.js";
import { resolveView } from "./view.js";
import { WIDGET_HTML } from "./generated/widget-html.js";
import { TRANSCRIPTS } from "./generated/transcripts.js";

// The ui:// scheme tells hosts this is an MCP App resource. The path
// structure is arbitrary; it just needs to match the tool's outputTemplate.
export const RESOURCE_URI = "ui://search-doctor-videos/mcp-app.html";

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
          "question, using YouTube's own keyword search as a first pass. Each result comes back with " +
          "its full, untruncated video description (not the ~130-character snippet YouTube's search " +
          "API normally returns) and its tags, on top of title/duration/publishedAt — read that full " +
          "description and tags yourself and use your own judgment about which result(s) actually " +
          "answer the question, since keyword ranking alone can surface a video that mentions the " +
          "right words in passing over one that's actually about the topic, or miss one that's " +
          "conceptually relevant but phrased differently. If the closest keyword match doesn't really " +
          "fit, say so and point to whichever one does, rather than defaulting to result order. When " +
          "a transcript is present (from a pre-built local dataset covering the channel's recent " +
          "uploads — not every video has one, and very new videos may not be in it yet), it's the " +
          "actual spoken content and is far more reliable for judging fit than the description or " +
          "title; prefer it when deciding which video to recommend and when describing what a video " +
          "actually covers. The " +
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
        const videos = await searchChannelVideos(query, maxResults ?? 8);
        const resolvedView = resolveView(view, videos.length);

        // Local lookup only — no network call, no Supadata dependency at
        // request time. TRANSCRIPTS is a pre-built dataset embedded at
        // build time (see scripts/fetch-transcripts.ts and
        // scripts/embed-transcripts.mjs); a video not in it just has no
        // transcript, same as any other optional field.
        for (const video of videos) {
          const transcript = TRANSCRIPTS[video.videoId];
          if (transcript) video.transcript = transcript;
        }

        return {
          content: [
            {
              type: "text",
              text: videos.length
                ? `${videos.length} video${videos.length === 1 ? "" : "s"} about "${query}": ` +
                  videos.map((v) => `"${v.title}" (${v.duration ?? "?"})`).join("; ") + "."
                : `No videos found about "${query}" on this channel. Try a different search term.`,
            },
          ],
          structuredContent: { query, view: resolvedView, videos },
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
