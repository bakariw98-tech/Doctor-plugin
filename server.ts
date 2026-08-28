// server.ts
console.log("Starting Doctor YouTube MCP App server...");

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  registerAppTool,
  registerAppResource,
  RESOURCE_MIME_TYPE,
} from "@modelcontextprotocol/ext-apps/server";
import cors from "cors";
import express from "express";
import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { searchChannelVideos } from "./src/youtube.js";

const server = new McpServer({
  name: "Doctor YouTube Search",
  version: "1.0.0",
});

// The ui:// scheme tells hosts this is an MCP App resource. The path
// structure is arbitrary; it just needs to match the tool's outputTemplate.
const resourceUri = "ui://search-doctor-videos/mcp-app.html";

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
      ui: { resourceUri },
      // ChatGPT (Apps SDK) compatibility alias for the same resource link.
      "openai/outputTemplate": resourceUri,
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
  resourceUri,
  { mimeType: RESOURCE_MIME_TYPE },
  async () => {
    const html = await fs.readFile(
      path.join(import.meta.dirname, "dist", "mcp-app.html"),
      "utf-8",
    );
    return {
      contents: [{ uri: resourceUri, mimeType: RESOURCE_MIME_TYPE, text: html }],
    };
  },
);

// Expose the MCP server over HTTP.
const app = express();
app.use(cors());
app.use(express.json());

app.post("/mcp", async (req, res) => {
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  res.on("close", () => transport.close());
  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
});

const PORT = Number(process.env.PORT ?? 3001);
app.listen(PORT, () => {
  console.log(`Doctor YouTube MCP server listening on http://localhost:${PORT}/mcp`);
});
