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

// Below this, a "match" is word-collision noise rather than a real steer —
// one common token shared between a question and an unrelated product. Found
// live: "what mic does she use" scored the sunscreen, and "what does she take
// for energy" scored a BBQ festival. Both were technically nonzero, so both
// came back framed as "the closest thing she actually uses", which is a
// worse answer than admitting there's no pick. Under the floor we fall
// through to the same honest path as a zero score: say plainly she has
// nothing for this, then offer what she's most known for.
const MATCH_FLOOR = 0.25;

// Where the click-tracking redirect lives. Buy links handed to the widget
// point here rather than straight at the merchant, so a click can be
// counted against the question that produced it (api/redirect.ts).
//
// A relative path used to be an acceptable fallback: the widget resolves it
// against the host page, so it degraded gracefully in that one context. It
// no longer is — the same URL now also goes out in the tool's plain text
// (buildResultText, src/mcp-server.ts) for hosts that don't render the
// widget at all, and a relative path handed to someone in a chat reply
// isn't a link, it's dead text with nothing to resolve it against. Vercel
// always provides VERCEL_URL, and local dev (server.ts) sets a default
// PUBLIC_BASE_URL of its own before this is ever called — so reaching this
// throw means a genuinely different deployment target forgot to set it,
// which is exactly the case that must fail loudly at request time rather
// than silently ship broken buy links to real chat clients.
function siteOrigin(): string {
  const explicit = process.env.PUBLIC_BASE_URL?.trim();
  if (explicit) return explicit.replace(/\/+$/, "");
  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim() || process.env.VERCEL_URL?.trim();
  if (vercel) return `https://${vercel.replace(/^https?:\/\//, "").replace(/\/+$/, "")}`;
  throw new Error(
    "Could not determine this deployment's public URL (checked PUBLIC_BASE_URL, " +
      "VERCEL_PROJECT_PRODUCTION_URL, VERCEL_URL). Buy links would be relative and broken for " +
      "anyone using the plugin from a real chat client. Set PUBLIC_BASE_URL to this " +
      "deployment's public origin, e.g. https://your-app.example.com.",
  );
}

export function trackedBuyUrl(productId: number, questionId: number | null): string {
  const suffix = questionId === null ? "" : `?q=${questionId}`;
  return `${siteOrigin()}/r/${productId}${suffix}`;
}

// What the widget draws — deliberately just enough to identify the product,
// complete the purchase, and (in the list density) tell one row from the
// next. `audience`, `brand`, `category` and `problem` stay out: they are the
// "why" and the "who", and they already reach the model as prose in the
// tool's `content` text (buildResultText, mcp-server.ts), which is where
// they're meant to be spoken from rather than printed on the card.
// `keywords` is match-only fuel the creator never meant to be read anywhere,
// and `enabled` is bookkeeping — neither ever belonged here.
export interface WirePick {
  id: number;
  name: string;
  imageUrl: string | null;
  priceNote: string | null;
  promoCode: string | null;
  /**
   * The one-liner. Drawn ONLY in the list density, where four-to-six results
   * can't have their reasons narrated in a short chat reply without becoming
   * the wall of text the whole interaction is trying to avoid. The single
   * detail card still doesn't draw it — there, the model says it once.
   */
  blurb: string;
  /** Rendered as the card's collapsed "how I use it". Absent when unset. */
  usage: string | null;
  buyUrl: string;
}

export function toWire(product: Product, questionId: number | null): WirePick {
  return {
    id: product.id,
    name: product.name,
    imageUrl: product.imageUrl,
    priceNote: product.priceNote,
    promoCode: product.promoCode,
    blurb: product.blurb,
    usage: product.usage,
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
    // `problem` and `usage` are what make a goal-shaped question ("trying to
    // get into cooking more") land on anything: without them the corpus is
    // all product nouns, and a question phrased as a need has nothing to
    // match. This raises recall on those; it does not make the matching
    // semantic — a miss still falls through to the weak/none steer.
    corpus[String(p.id)] = [p.name, p.brand, p.category, p.blurb, p.audience, p.problem, p.usage, p.keywords]
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

  if (matches.length === 0 || matches[0].coverage < MATCH_FLOOR) {
    // Nothing matched well enough to answer with. Steering still beats an
    // empty answer, but ONE steer — not a filled quota of them.
    //
    // This used to return `maxResults` most-clicked products, which meant
    // every unanswerable question got the same three best-sellers. Found
    // live: "trying to get lean" answered with Shopify, a storefront
    // platform, presented alongside two others as what she recommends. Three
    // unrelated products reads as the catalog dump this product exists to
    // replace; one reads as a person saying "not that, but maybe this".
    //
    // A below-floor match is still topically closer than a global
    // best-seller — it shares SOME word with the question — so it's the
    // better steer when one exists. Quality stays "none" either way, so the
    // model is told to say plainly that there's no real pick for this.
    const nearest = matches[0] ? byId.get(matches[0].id) : undefined;
    const products = nearest ? [nearest] : await mostClickedProducts(1);
    return { products, quality: "none" };
  }

  const products = matches.map((m) => byId.get(m.id)).filter((p): p is Product => Boolean(p));
  return { products, quality: matches[0].coverage >= MATCH_STRONG ? "strong" : "weak" };
}

