// api/recommend.ts
// Plain REST endpoint (not part of MCP) backing the standalone demo page
// at the site root — GET /api/recommend?q=... -> { question, products }.
// Shares src/recommend.ts with the MCP tool so the preview and the real
// thing match; the one difference is that this path does not log the
// question, since a developer poking at the demo isn't the creator's
// audience asking for something and shouldn't pollute the gap report.
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { pickProducts, toWire } from "../src/recommend.js";
import { resolveView, type ViewOption } from "../src/view.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");

  if (req.method !== "GET") {
    res.status(405).json({ error: "Method not allowed." });
    return;
  }

  const question = typeof req.query.q === "string" ? req.query.q.trim() : "";
  if (!question) {
    res.status(400).json({ error: "Missing required query parameter 'q'." });
    return;
  }

  const maxParam = req.query.max;
  const maxResults = typeof maxParam === "string" ? Number(maxParam) : undefined;
  const viewParam = typeof req.query.view === "string" ? (req.query.view as ViewOption) : undefined;

  try {
    const { products, quality } = await pickProducts(question, maxResults ?? 8);
    const view = resolveView(viewParam, products.length);
    res.status(200).json({
      question,
      view,
      matchQuality: quality,
      products: products.map((p) => toWire(p, null)),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
}
