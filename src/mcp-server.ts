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
import { pickProducts, toWire } from "./recommend.js";
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

function buildResultText(question: string, quality: MatchQuality, products: Product[]): string {
  if (products.length === 0) {
    return "There's nothing in the catalog yet, so there's no recommendation to give for " +
      `"${question}". Say so plainly — don't suggest a product from general knowledge.`;
  }

  const lines = products.map((p) => {
    const parts = [`${p.name}${p.brand ? ` (${p.brand})` : ""}`];
    if (p.blurb) parts.push(`Their words: "${p.blurb}"`);
    if (p.audience) parts.push(`Who it's for: ${p.audience}`);
    if (p.priceNote) parts.push(`Price note: ${p.priceNote}`);
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

  return `${header}\n${lines}\n\nThe widget already shows the name, their line, and a Get it ` +
    `button — don't repeat all of it back in prose.`;
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
        "How to speak the result:\n" +
        "- The blurb in the response is the CREATOR'S own words about why they use it. Present it " +
        "as theirs, not as your own assessment.\n" +
        "- Never invent a product, a reason, a price, or a spec that isn't in the response. If " +
        "someone asks about something the catalog doesn't cover, the response will say so — pass " +
        "that on honestly and offer what's there instead. Don't stretch a weak match into a " +
        "confident recommendation, and equally don't just say 'I don't know' and stop: steer them " +
        "to something real ('he doesn't have a pan he recommends, but he does swear by this knife " +
        "for prep').\n" +
        "- The widget draws the product name, the creator's line, and a Get it button. Keep your " +
        "own reply short — a sentence of framing, not a recital of the card.\n" +
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
          "'one' (default): the single best pick, shown as one detailed card. 'few': up to 3, for " +
          "when they've explicitly asked to compare options or want alternatives.",
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
          content: [{ type: "text", text: buildResultText(question, quality, products) }],
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
        "where there's no single specific need to match against. For a specific question ('what " +
        "knife do you use'), call recommend_product instead: it picks rather than lists, and it's " +
        "the one that records what the audience is asking for.",
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
        const all = await listProducts({ enabledOnly: true });
        const wanted = category?.trim().toLowerCase();
        const products = wanted
          ? all.filter((p) => (p.category ?? "").toLowerCase().includes(wanted))
          : all;

        const text = products.length === 0
          ? (wanted
            ? `They don't have anything listed under "${category}". Say so plainly rather than ` +
              `guessing at products they might use.`
            : "There's nothing in the catalog yet — say so rather than suggesting products from " +
              "general knowledge.")
          : `${products.length} recommendation${products.length === 1 ? "" : "s"}` +
            `${wanted ? ` under "${category}"` : ""}. Each card carries the creator's own line ` +
            `about it and a Get it button, so keep your reply brief:\n` +
            products.map((p) => `- ${p.name}${p.brand ? ` (${p.brand})` : ""}` +
              `${p.blurb ? ` — "${p.blurb}"` : ""}`).join("\n");

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
