// src/mcp-server.ts
// Builds a configured McpServer instance. Shared by the local dev server
// (server.ts, Express + long-lived process) and the Vercel serverless
// function (api/mcp.ts, one instance per request) so both stay in sync.
//
// The product this serves: a creator's audience asks "what do you use for
// X", and the answer is the creator's own curated pick plus a link to buy
// it. Not a search over their videos, not a clip with a timestamp — a
// recommendation, with the buy step already attached.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  registerAppTool,
  registerAppResource,
  RESOURCE_MIME_TYPE,
} from "@modelcontextprotocol/ext-apps/server";
import { z } from "zod";
import { WIDGET_HTML } from "./generated/widget-html.js";
import { listProducts, logQuestion, type MatchQuality, type Product } from "./db.js";
import { pickProducts, toWire, trackedBuyUrl } from "./recommend.js";
import { resolveView, type ViewMode } from "./view.js";

// The ui:// scheme tells hosts this is an MCP App resource. The path
// structure is arbitrary; it just needs to match the tool's outputTemplate.
export const RESOURCE_URI = "ui://creator-picks/mcp-app.html";

// The Supabase Storage origin the widget needs on its CSP allowlist to
// actually load an uploaded product photo — same env var src/storage.ts
// uploads to, so this only ever needs to be set once. Returns null (no
// entry added) rather than throwing when unset, since the resource
// registration below must succeed even without storage configured.
function supabaseStorageOrigin(): string | null {
  const url = process.env.SUPABASE_URL?.trim();
  return url ? url.replace(/\/+$/, "") : null;
}

function buildResultText(
  question: string,
  quality: MatchQuality,
  products: Product[],
  questionId: number | null,
): string {
  if (products.length === 0) {
    return "There's nothing in the catalog yet, so there's no recommendation to give for " +
      `"${question}". Say so plainly — don't suggest a product from general knowledge.`;
  }

  const lines = products.map((p) => {
    const parts = [`${p.name}${p.brand ? ` (${p.brand})` : ""}`];
    if (p.blurb) parts.push(`Their words: "${p.blurb}"`);
    if (p.audience) parts.push(`Who it's for: ${p.audience}`);
    if (p.problem) parts.push(`What it solves: ${p.problem}`);
    if (p.usage) parts.push(`How they use it: ${p.usage}`);
    if (p.priceNote) parts.push(`Price note: ${p.priceNote}`);
    if (p.promoCode) parts.push(`Promo code: ${p.promoCode}`);
    // The link goes in the TEXT, not just structuredContent. The widget is an
    // enhancement, never the delivery mechanism: on any host that doesn't
    // render MCP-Apps UI — Gemini, a new agent, or Claude/ChatGPT when the
    // widget fails to load — a payload-only link means the person gets a
    // recommendation and no way to buy it, which is the entire point gone.
    parts.push(`Buy link: ${trackedBuyUrl(p.id, questionId)}`);
    return `- ${parts.join(" — ")}`;
  }).join("\n");

  const header = quality === "strong"
    ? `Their pick for "${question}":`
    : quality === "weak"
      ? `Nothing in the catalog answers "${question}" directly. The closest thing they actually ` +
        `use is below — offer it as a steer, and say plainly that it isn't quite what was asked for:`
      : `Nothing in the catalog covers "${question}" at all. Below is what they recommend most ` +
        `generally — say clearly that they don't have a pick for what was asked, then offer this ` +
        `as the nearest real thing rather than leaving them with nothing:`;

  return `${header}\n${lines}\n\n` +
    `The card${products.length === 1 ? "" : "s"} show${products.length === 1 ? "s" : ""} the ` +
    `photo, name, price and a Get it button — not their words. Say the reason yourself, in their ` +
    `voice, in a sentence or two per pick. "How they use it" is already on the card behind a tap, ` +
    `so only mention it if it answers what was actually asked. If there's a promo code, say it ` +
    `aloud as well as it being on the card.\n\nIf the card isn't showing for any reason, include ` +
    `the buy link in your reply as a plain link — never leave someone with a recommendation and ` +
    `no way to act on it.`;
}

export function createMcpServer(): McpServer {
  const server = new McpServer({
    name: "Creator Picks",
    version: "1.0.0",
  });

  registerAppTool(
    server,
    "recommend_product",
    {
      title: "Recommend a Product",
      description:
        "Answers 'what do you use for X' style questions with the creator's own curated product " +
        "pick and a link to buy it. Use this whenever someone asks what the creator uses, wears, " +
        "takes, cooks with, films with, or recommends for a specific job — anything where the " +
        "answer is a thing they can buy.\n\n" +
        "Pass the person's question as they actually asked it. Don't reduce it to a keyword: the " +
        "raw phrasing is what the creator's gap report is built from, and it's how they learn what " +
        "their audience wants that they don't yet recommend.\n\n" +
        "Use it for goal-shaped questions too, not just product ones — \"I'm trying to get into " +
        "cooking more, what should I get\" is this tool with mode 'few', matched against what each " +
        "product solves. (Browsing a whole category with no particular need — \"what does she " +
        "recommend for the kitchen\" — is list_recommendations instead.)\n\n" +
        "How to speak the result:\n" +
        "- Answer the way the CREATOR would answer, in their cadence. The person asking already " +
        "trusts this creator's taste — they came for the answer, not to be sold. It should read " +
        "like a text back from someone they follow, not a database summary or a product review.\n" +
        "- Keep it short. One or two lines, then stop. No spec sheets, no 'five things to consider " +
        "before buying a knife', no comparison tables nobody asked for.\n" +
        "- The blurb and the how-they-use-it in the response are the CREATOR'S own words. Present " +
        "them as theirs, not as your own assessment.\n" +
        "- Never invent a product, a reason, a price, or a spec that isn't in the response. If " +
        "someone asks about something the catalog doesn't cover, the response will say so — pass " +
        "that on honestly and offer what's there instead. Don't stretch a weak match into a " +
        "confident recommendation, and equally don't just say 'I don't know' and stop: steer them " +
        "to something real ('he doesn't have a pan he recommends, but he does swear by this knife " +
        "for prep').\n" +
        "- Every pick, one or several, renders as the same large card — photo, name, price, a " +
        "Get it button, and \"how I use it\" behind a tap. Say the reason(s) yourself; the card " +
        "never prints the blurb. Never more than 3 cards — if the honest answer is 'she has a " +
        "dozen kitchen things', name the 3 that best fit what was actually asked, not everything " +
        "she owns. A promo code shows as a small chip, but say it too rather than assuming they'll " +
        "spot it.\n" +
        "- There is no email signup, no free guide, and nothing to collect from the person. The " +
        "recommendation and the buy link are the whole answer.",
      inputSchema: {
        question: z.string().describe(
          "The person's question, in their own words, as close to verbatim as possible — e.g. " +
          "'what knife do you use for everyday cooking' or 'what do you use to stay lean'. Don't " +
          "compress it to keywords; the exact phrasing is recorded so the creator can see what " +
          "their audience is asking for.",
        ),
        mode: z.enum(["one", "few"]).optional().describe(
          "'one' (default): the single best pick, shown as one detailed card. 'few': up to 3, " +
          "same large card format, side by side — use it when they've asked to compare, want " +
          "alternatives, or asked something goal-shaped ('trying to get into X') where several " +
          "things could genuinely help rather than one obvious answer. Never more than 3: someone " +
          "shown a long list doesn't pick, they bounce — if more than 3 things would qualify, " +
          "that's a signal to pick the 3 strongest rather than dump the rest.",
        ),
      },
      _meta: {
        ui: { resourceUri: RESOURCE_URI },
        // ChatGPT (Apps SDK) compatibility alias for the same resource link.
        "openai/outputTemplate": RESOURCE_URI,
        "openai/toolInvocation/invoking": "Looking up what they use…",
        "openai/toolInvocation/invoked": "Here's their pick.",
      },
    },
    async ({ question, mode }) => {
      try {
        const maxResults = mode === "few" ? 3 : 1;
        const { products, quality } = await pickProducts(question, maxResults);

        // Logged even when nothing matched — especially when nothing
        // matched. An unanswered question is the single most valuable row
        // in this table: it's a product the audience wants and the creator
        // isn't recommending yet.
        let questionId: number | null = null;
        try {
          questionId = await logQuestion({
            question,
            productId: products[0]?.id ?? null,
            matchQuality: quality,
          });
        } catch {
          // Analytics must never cost a recommendation.
        }

        const view: ViewMode = resolveView(undefined, products.length);
        return {
          content: [{ type: "text", text: buildResultText(question, quality, products, questionId) }],
          structuredContent: {
            kind: "products" as const,
            question,
            view,
            matchQuality: quality,
            products: products.map((p) => toWire(p, questionId)),
          },
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text", text: `Could not load recommendations: ${message}` }],
          isError: true,
        };
      }
    },
  );

  registerAppTool(
    server,
    "list_recommendations",
    {
      title: "List Recommendations",
      description:
        "Shows what the creator recommends, optionally narrowed to one category — for browsing " +
        "questions like 'what does he recommend for the kitchen' or 'what gear does she use', " +
        "where there's no single specific need to match against. Shows at most 3 — a long list " +
        "isn't a browsing experience here, it's a wall someone bounces off, so this always picks " +
        "the 3 to show rather than dumping every match. For a specific question ('what knife do " +
        "you use'), call recommend_product instead: it picks rather than lists, and it's the one " +
        "that records what the audience is asking for.",
      inputSchema: {
        category: z.string().optional().describe(
          "Optional category filter, matched case-insensitively against the creator's own " +
          "category labels (e.g. 'kitchen', 'training', 'camera'). Omit to list everything.",
        ),
      },
      _meta: {
        ui: { resourceUri: RESOURCE_URI },
        "openai/outputTemplate": RESOURCE_URI,
        "openai/toolInvocation/invoking": "Pulling up their recommendations…",
        "openai/toolInvocation/invoked": "Here's what they recommend.",
      },
    },
    async ({ category }) => {
      try {
        const LIST_CAP = 3;
        const all = await listProducts({ enabledOnly: true });
        const wanted = category?.trim().toLowerCase();
        const matched = wanted
          ? all.filter((p) => (p.category ?? "").toLowerCase().includes(wanted))
          : all;
        // Never render more than a handful — someone shown everything the
        // creator sells doesn't pick, they bounce. Found live: "what
        // utensils does he use" with no matching category fell through to
        // "list everything", and the whole 21-product catalog rendered as
        // one screen. Most-clicked first, so the cap keeps what's proven to
        // convert rather than an arbitrary slice.
        const products = matched
          .slice()
          .sort((a, b) => b.id - a.id)
          .slice(0, LIST_CAP);

        const text = products.length === 0
          ? (wanted
            ? `They don't have anything listed under "${category}". Say so plainly rather than ` +
              `guessing at products they might use.`
            : "There's nothing in the catalog yet — say so rather than suggesting products from " +
              "general knowledge.")
          : `Showing ${products.length} of ${matched.length} match${matched.length === 1 ? "" : "es"}` +
            `${wanted ? ` under "${category}"` : ""} — the strongest picks, not the whole catalog. ` +
            `Say each one's reason yourself, briefly:\n` +
            products.map((p) => `- ${p.name}${p.brand ? ` (${p.brand})` : ""}` +
              `${p.blurb ? ` — "${p.blurb}"` : ""}` +
              `${p.promoCode ? ` — Promo code: ${p.promoCode}` : ""}` +
              ` — Buy link: ${trackedBuyUrl(p.id, null)}`).join("\n");

        return {
          content: [{ type: "text", text }],
          structuredContent: {
            kind: "products" as const,
            question: category ? `Recommendations: ${category}` : "Recommendations",
            view: resolveView(undefined, products.length),
            matchQuality: "strong" as const,
            products: products.map((p) => toWire(p, null)),
          },
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text", text: `Could not load recommendations: ${message}` }],
          isError: true,
        };
      }
    },
  );

  registerAppResource(
    server,
    "Creator Picks",
    RESOURCE_URI,
    { mimeType: RESOURCE_MIME_TYPE },
    async () => {
      const RESOURCE_DOMAINS = [
        ...(supabaseStorageOrigin() ? [supabaseStorageOrigin()!] : []),
      ];
      return {
        contents: [
          {
            uri: RESOURCE_URI,
            mimeType: RESOURCE_MIME_TYPE,
            text: WIDGET_HTML,
            _meta: {
              ui: {
                // No embedded merchant page (no frameDomains needed) —
                // tapping Get it always opens the buy link externally via
                // app.openLink, so there's no iframe CSP to fight across
                // hosts. resourceDomains covers every external image the
                // widget actually loads, which is why /admin uploads
                // product photos to one Supabase Storage bucket
                // (src/storage.ts) rather than hotlinking merchant CDNs:
                // this allowlist is fixed at registration time and can't
                // enumerate every retailer a creator might link to.
                // Confirmed live on the previous version that without the
                // origin here, the host silently blocks the image — no
                // error anywhere, it just renders blank.
                csp: {
                  resourceDomains: RESOURCE_DOMAINS,
                },
              },
              // ChatGPT's documented legacy compatibility key — same list,
              // snake_case field names. Per OpenAI's own Apps SDK reference,
              // the standard ui.csp above is "preferred" but this older key
              // is still what some ChatGPT surfaces actually enforce; an
              // image rendering fine on Claude but staying blank
              // specifically on ChatGPT matches that gap exactly. Costs
              // nothing to duplicate — Claude ignores unknown _meta keys.
              "openai/widgetCSP": {
                resource_domains: RESOURCE_DOMAINS,
              },
            },
          },
        ],
      };
    },
  );

  return server;
}
