// api/linkcheck.ts
// Runs src/linkcheck.ts's catalog sweep as a Vercel serverless function.
// Two ways in, because this has two different callers:
//
//   1. Vercel Cron (see the `crons` entry in vercel.json) hits this daily
//      and authenticates with the CRON_SECRET env var Vercel injects as
//      `Authorization: Bearer <value>` — see
//      https://vercel.com/docs/cron-jobs/manage-cron-jobs#securing-cron-jobs.
//   2. The creator, from /admin, hits it on demand with their existing
//      ADMIN_TOKEN rather than learning a second secret.
//
// GET, not POST: Vercel Cron only ever sends GET, and there's no request
// body either caller needs — the ?limit= query param is enough.
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { checkCatalog } from "../src/linkcheck.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET") {
    res.status(405).json({ error: "Method not allowed." });
    return;
  }

  const auth = req.headers.authorization ?? "";
  const bearer = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  const cronSecret = process.env.CRON_SECRET?.trim();
  const adminToken = process.env.ADMIN_TOKEN?.trim();
  const queryToken = typeof req.query.token === "string" ? req.query.token : "";

  const authorized =
    (!!cronSecret && bearer === cronSecret) ||
    (!!adminToken && (bearer === adminToken || queryToken === adminToken));

  if (!authorized) {
    res.status(401).json({ error: "Missing or invalid credentials." });
    return;
  }

  const limitParam = req.query.limit;
  const limit = typeof limitParam === "string" ? Number(limitParam) : undefined;

  try {
    const summary = await checkCatalog(limit && Number.isFinite(limit) ? { limit } : {});
    res.status(200).json(summary);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
}
