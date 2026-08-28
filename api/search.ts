// api/search.ts
// Plain REST endpoint (not part of MCP) backing the standalone demo page
// at the site root — GET /api/search?q=... -> { query, videos }.
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { searchChannelVideos } from "../src/youtube.js";
import { resolveView, type ViewOption } from "../src/view.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");

  if (req.method !== "GET") {
    res.status(405).json({ error: "Method not allowed." });
    return;
  }

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
}
