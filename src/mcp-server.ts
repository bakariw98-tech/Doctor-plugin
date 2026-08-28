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
import { WIDGET_HTML } from "./generated/widget-html.js";

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
        "Searches the configured doctor's YouTube channel for videos matching a symptom, topic, or question, and renders the matches as a playable video carousel.",
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
      },
      _meta: {
        ui: { resourceUri: RESOURCE_URI },
        // ChatGPT (Apps SDK) compatibility alias for the same resource link.
        "openai/outputTemplate": RESOURCE_URI,
        "openai/toolInvocation/invoking": "Searching the channel…",
        "openai/toolInvocation/invoked": "Here's what I found.",
      },
    },
    async ({ query, maxResults }) => {
      try {
        const videos = await searchChannelVideos(query, maxResults ?? 8);
        return {
          content: [
            {
              type: "text",
              text: videos.length
                ? `Found ${videos.length} video${videos.length === 1 ? "" : "s"} about "${query}" on the channel.`
                : `No videos found about "${query}" on this channel. Try a different search term.`,
            },
          ],
          structuredContent: { query, videos },
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
              // The host renders the widget in a sandboxed iframe with a
              // deny-by-default CSP. Without this, frame-src is 'none' and
              // the YouTube embed is silently blocked — it plays in a plain
              // browser tab (no sandbox) but not inside the widget. Not
              // every host honors this yet, which is why the widget also
              // has an "Open on YouTube" fallback via app.openLink.
              csp: {
                frameDomains: ["https://www.youtube.com"],
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
