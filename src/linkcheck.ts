// src/linkcheck.ts
// Periodically verifies that the buy links in the catalog still resolve.
//
// Affiliate links rot faster than anything else in this product: programs
// get discontinued, merchants restructure their URLs, a partner ID gets
// revoked, a product goes out of stock permanently. When that happens the
// plugin keeps recommending it — confidently, in the creator's voice, to
// their own audience — and every tap is a lost sale plus a small
// embarrassment in front of the people who trust them. Nothing else in
// the system notices: /r/<id> still 302s happily to a 404.
//
// The hard part is not fetching the URL, it's deciding what a failure
// means. Amazon, Impact, ShareASale and most affiliate networks routinely
// return 403 or 429 to a datacenter IP with no browser fingerprint. A
// checker that called those "dead" would light up the whole dashboard
// every single day and the creator would learn to ignore it — strictly
// worse than not having the feature. So this reports three states, and
// only ever claims "dead" for a response that actually says the thing is
// gone.
import { listProducts, recordLinkCheck, type LinkStatus, type Product } from "./db.js";

export interface LinkCheckResult {
  status: LinkStatus;
  /** Final HTTP status, or null when the request never got one (DNS, TLS, timeout). */
  httpStatus: number | null;
  /** Short human explanation, shown to the creator in /admin. */
  note: string;
}

const TIMEOUT_MS = 10_000;

// A real browser UA. Not to be sneaky — plenty of merchants serve a bot
// challenge to anything else, and a challenge page is indistinguishable
// from a dead link at the status-code level. This just gets us a status
// code that means what it says.
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";

/**
 * Checks one URL. Never throws — a checker that can fail is a checker
 * that takes the whole nightly run down with it on one bad host.
 */
export async function checkUrl(url: string): Promise<LinkCheckResult> {
  // HEAD first: it's cheaper and most merchants support it. But a good
  // number answer 405/501 to HEAD while serving GET fine, and some CDNs
  // answer HEAD with a bare 403 — so anything that isn't a clear verdict
  // gets retried as a GET before we say anything about the link.
  const head = await attempt(url, "HEAD");
  if (head.status === "ok" || head.status === "dead") return head;
  return attempt(url, "GET");
}

async function attempt(url: string, method: "HEAD" | "GET"): Promise<LinkCheckResult> {
  try {
    const res = await fetch(url, {
      method,
      redirect: "follow", // affiliate links are almost always a redirect chain
      headers: { "user-agent": USER_AGENT, accept: "*/*" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    return classify(res.status);
  } catch (err) {
    // Timeout, DNS failure, TLS failure, connection refused. Any of these
    // can be the merchant being down for ten minutes, so none of them is
    // evidence the link is dead.
    const reason = err instanceof Error ? err.message : String(err);
    return { status: "unknown", httpStatus: null, note: `Could not reach it (${reason})` };
  }
}

function classify(httpStatus: number): LinkCheckResult {
  if (httpStatus >= 200 && httpStatus < 300) {
    return { status: "ok", httpStatus, note: "Resolves fine" };
  }
  // The only two codes that mean "this specific thing is gone". 410 is
  // explicit; 404 is the one every retired product page returns.
  if (httpStatus === 404 || httpStatus === 410) {
    return { status: "dead", httpStatus, note: `Merchant returned ${httpStatus} — the page is gone` };
  }
  if (httpStatus === 401 || httpStatus === 403 || httpStatus === 429) {
    return {
      status: "unknown",
      httpStatus,
      note: `Merchant blocked the check (${httpStatus}) — normal for Amazon and most affiliate networks, not a dead link`,
    };
  }
  if (httpStatus >= 500) {
    return { status: "unknown", httpStatus, note: `Merchant erroring (${httpStatus}) — probably temporary` };
  }
  return { status: "unknown", httpStatus, note: `Unexpected response (${httpStatus})` };
}

export interface CatalogCheckSummary {
  checked: number;
  ok: number;
  dead: number;
  unknown: number;
  /** Products that came back dead, so the caller can name them in a log or an alert. */
  deadProducts: { id: number; name: string; buyUrl: string; note: string }[];
}

const CONCURRENCY = 4;

/**
 * Checks the stalest `limit` links in the catalog and records the results.
 *
 * Stalest-first rather than all-at-once so this stays inside a serverless
 * function's time budget no matter how big a client's catalog gets: each
 * run takes the oldest slice, and successive runs walk the whole thing.
 * Enabled products are checked ahead of disabled ones at equal staleness —
 * a broken link only costs a sale while it's live in front of the audience.
 */
export async function checkCatalog(opts: { limit?: number } = {}): Promise<CatalogCheckSummary> {
  const limit = opts.limit ?? 40;
  const products = await listProducts();
  const queue = [...products]
    .sort((a, b) => {
      if (a.enabled !== b.enabled) return a.enabled ? -1 : 1;
      // Never-checked (null) sorts first — an unverified link is the
      // stalest thing there is.
      const at = a.linkCheckedAt ?? "";
      const bt = b.linkCheckedAt ?? "";
      return at.localeCompare(bt);
    })
    .slice(0, limit);

  const summary: CatalogCheckSummary = { checked: 0, ok: 0, dead: 0, unknown: 0, deadProducts: [] };

  // A fixed number of workers pulling from one queue, rather than
  // Promise.all over everything — a 200-product catalog would otherwise
  // open 200 sockets at once and look like an attack to the merchants
  // we're trying to stay in good standing with.
  let cursor = 0;
  async function worker() {
    for (;;) {
      const product: Product | undefined = queue[cursor++];
      if (!product) return;
      const result = await checkUrl(product.buyUrl);
      await recordLinkCheck(product.id, result);
      summary.checked += 1;
      summary[result.status] += 1;
      if (result.status === "dead") {
        summary.deadProducts.push({
          id: product.id,
          name: product.name,
          buyUrl: product.buyUrl,
          note: result.note,
        });
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, worker));

  return summary;
}
