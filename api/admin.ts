// api/admin.ts
// The leads dashboard, as a Vercel serverless function. Deployed at
// /api/admin (also reachable at /admin via the rewrite in vercel.json).
// An ordinary HTTP page, not part of the MCP protocol — see src/admin.ts
// for the actual logic and why it has its own security headers separate
// from the widget's ui:// CSP.
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { handleAdminRequest, type AdminRequest } from "../src/admin.js";

// Vercel's Node runtime auto-parses the body based on Content-Type
// (including application/x-www-form-urlencoded, same mechanism api/mcp.ts
// already relies on for its JSON bodies) into req.body as an object — but
// fall back to parsing it ourselves if it ever arrives as a raw string,
// rather than assuming that always holds.
function parseFormBody(body: unknown): Record<string, string> {
  if (body && typeof body === "object") {
    const out: Record<string, string> = {};
    for (const [key, value] of Object.entries(body as Record<string, unknown>)) {
      if (typeof value === "string") out[key] = value;
    }
    return out;
  }
  if (typeof body === "string") {
    return Object.fromEntries(new URLSearchParams(body));
  }
  return {};
}

function parseCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return decodeURIComponent(rest.join("="));
  }
  return undefined;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const action = typeof req.query.action === "string" ? req.query.action : undefined;

  const adminReq: AdminRequest = {
    method: req.method ?? "GET",
    action,
    body: req.method === "POST" ? parseFormBody(req.body) : {},
    cookie: parseCookie(req.headers.cookie, "admin_session"),
  };

  try {
    const result = await handleAdminRequest(adminReq);
    for (const [key, value] of Object.entries(result.headers)) {
      res.setHeader(key, value);
    }
    res.status(result.status).send(result.body);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).send(`<p>Admin page error: ${message}</p>`);
  }
}
