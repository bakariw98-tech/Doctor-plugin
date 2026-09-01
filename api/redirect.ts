// api/redirect.ts
// GET /r/<productId>?q=<questionId> — counts the click, then sends the
// person on to the product's stored buy link.
//
// SECURITY: the destination is looked up from the database by id and is
// never taken from the request. There is deliberately no `url` parameter
// to honor — accepting one would turn this into an open redirect that
// anyone could use to launder a malicious link through the creator's
// domain. /admin is the only place a buy link can be set, and it only
// stores http(s) URLs (normalizeBuyUrl in src/admin.ts).
//
// Analytics must never cost a sale: if the click can't be logged, the
// redirect still happens.
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getProduct, logClick } from "../src/db.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.status(405).send("Method not allowed.");
    return;
  }

  // Vercel's rewrite gives us /r/:id as a path param; fall back to parsing
  // the URL so this works however it's routed.
  const rawId = typeof req.query.id === "string"
    ? req.query.id
    : (req.url ?? "").split("?")[0].split("/").filter(Boolean).pop() ?? "";
  const productId = Number(rawId);
  if (!Number.isFinite(productId)) {
    res.status(404).send("Not found.");
    return;
  }

  let product;
  try {
    product = await getProduct(productId);
  } catch {
    res.status(502).send("Could not look that up. Please try again.");
    return;
  }
  if (!product) {
    res.status(404).send("Not found.");
    return;
  }

  const rawQuestion = typeof req.query.q === "string" ? Number(req.query.q) : NaN;
  try {
    await logClick({ productId, questionId: Number.isFinite(rawQuestion) ? rawQuestion : null });
  } catch {
    // Deliberately swallowed — see the header note.
  }

  res.redirect(302, product.buyUrl);
}
