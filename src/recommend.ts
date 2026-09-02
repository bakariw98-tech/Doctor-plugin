// src/recommend.ts
// Turning a person's question into the creator's pick. Shared by the MCP
// tool (src/mcp-server.ts) and the plain REST endpoint behind the demo
// page (api/recommend.ts, and the local /api/recommend route in
// server.ts), so both answer identically — the browser preview is only
// useful if it exercises the same matching the real thing does.
import { findMatches } from "./match.js";
import { listProducts, mostClickedProducts, type MatchQuality, type Product } from "./db.js";

// Share of the question's IDF mass a product must match to count as a real
// answer rather than a steer. Below this the recommendation still goes out
// — never coming up empty is the point — but flagged so the model says
// plainly that it isn't quite what they asked for.
const MATCH_STRONG = 0.6;

// Where the click-tracking redirect lives. Buy links handed to the widget
// point here rather than straight at the merchant, so a click can be
// counted against the question that produced it (api/redirect.ts). Falls
// back to a relative path when the deployment URL isn't known — the widget
// resolves it against the host page, and a click that can't be attributed
// is still better than a link that doesn't work.
function siteOrigin(): string {
  const explicit = process.env.PUBLIC_BASE_URL?.trim();
  if (explicit) return explicit.replace(/\/+$/, "");
  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim() || process.env.VERCEL_URL?.trim();
  return vercel ? `https://${vercel.replace(/^https?:\/\//, "").replace(/\/+$/, "")}` : "";
}

function trackedBuyUrl(productId: number, questionId: number | null): string {
  const suffix = questionId === null ? "" : `?q=${questionId}`;
  return `${siteOrigin()}/r/${productId}${suffix}`;
}

// What the widget draws — deliberately just enough to identify the product
// and complete the purchase. Everything else (blurb, audience, brand,
// category — the "why", not the "what") stays out of this payload on
// purpose: it already reaches the model as prose in the tool's `content`
// text (buildResultText, mcp-server.ts), which is where it's meant to be
// spoken from, not printed a second time on the card. `keywords` is
// match-only fuel the creator never meant to be read anywhere, and
// `enabled` is bookkeeping — neither ever belonged here.
export interface WirePick {
  id: number;
  name: string;
  imageUrl: string | null;
  priceNote: string | null;
  promoCode: string | null;
  buyUrl: string;
}

export function toWire(product: Product, questionId: number | null): WirePick {
  return {
    id: product.id,
    name: product.name,
    imageUrl: product.imageUrl,
    priceNote: product.priceNote,
    promoCode: product.promoCode,
    buyUrl: trackedBuyUrl(product.id, questionId),
  };
}

// The corpus the question is scored against. Keywords are included here
// but never rendered — that's the whole point of having the field: a
// creator can make "what do you use to stay lean" find the creatine
// without writing the words "stay lean" into copy meant for a human.
function buildCorpus(products: Product[]): Record<string, string> {
  const corpus: Record<string, string> = {};
  for (const p of products) {
    corpus[String(p.id)] = [p.name, p.brand, p.category, p.blurb, p.audience, p.keywords]
      .filter(Boolean)
      .join(" ");
  }
  return corpus;
}

export interface Picked {
  products: Product[];
  quality: MatchQuality;
}

export async function pickProducts(question: string, maxResults: number): Promise<Picked> {
  const catalog = await listProducts({ enabledOnly: true });
  if (catalog.length === 0) return { products: [], quality: "none" };

  const byId = new Map(catalog.map((p) => [String(p.id), p]));
  const matches = findMatches(question, buildCorpus(catalog), maxResults);

  if (matches.length === 0) {
    // Nothing matched at all. Steering beats an empty answer, so fall back
    // to what the audience actually buys and let the model be honest about
    // why it's offering it.
    return { products: await mostClickedProducts(maxResults), quality: "none" };
  }

  const products = matches.map((m) => byId.get(m.id)).filter((p): p is Product => Boolean(p));
  return { products, quality: matches[0].coverage >= MATCH_STRONG ? "strong" : "weak" };
}

