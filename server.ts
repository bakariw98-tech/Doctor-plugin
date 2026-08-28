// server.ts
// Local dev server: serves the MCP endpoint, the /api/search REST helper,
// and the static demo page (public/index.html) all from one Express app,
// mirroring what api/mcp.ts + api/search.ts + public/ serve on Vercel.
console.log("Starting Doctor YouTube MCP App server...");

import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import cors from "cors";
import express from "express";
import path from "node:path";
import { createMcpServer } from "./src/mcp-server.js";
import { searchChannelVideos } from "./src/youtube.js";
import { resolveView, type ViewOption } from "./src/view.js";

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(import.meta.dirname, "public")));

app.post("/mcp", async (req, res) => {
  const server = createMcpServer();
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  res.on("close", () => {
    transport.close();
    void server.close();
  });
  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
});

app.get("/api/search", async (req, res) => {
  const query = typeof req.query.q === "string" ? req.query.q.trim() : "";
  if (!query) {
    res.status(400).json({ error: "Missing required query parameter 'q'." });
    return;
  }
  const maxParam = req.query.max;
  const maxResults = typeof maxParam === "string" ? Number(maxParam) : undefined;
  const viewParam = typeof req.query.view === "string" ? (req.query.view as ViewOption) : undefined;

  try {
    const videos = await searchChannelVideos(query, maxResults ?? 8);
    const view = resolveView(viewParam, videos.length);
    res.status(200).json({ query, view, videos });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

const PORT = Number(process.env.PORT ?? 3001);
app.listen(PORT, () => {
  console.log(`Doctor YouTube MCP server listening on http://localhost:${PORT}/mcp`);
  console.log(`Demo page:                        http://localhost:${PORT}/`);
});
