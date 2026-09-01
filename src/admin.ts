// src/admin.ts
// Runtime-agnostic logic for the /admin dashboard — the creator's simple,
// password-protected page to manage their product catalog and read what
// their audience is asking for. This is a plain HTTP page, NOT part of
// the MCP protocol/widget — separate from the ui:// resource's CSP
// entirely (see the header comment in api/admin.ts).
//
// Deliberately not enterprise-grade auth: a single shared ADMIN_TOKEN
// compared against a cookie value. Good enough for "the creator has one
// link only they know," not a real multi-user auth system — treat
// ADMIN_TOKEN as a real credential (long, random) since anyone who has it
// can rewrite what the plugin recommends to that creator's audience.
//
// api/admin.ts (Vercel) and the /admin routes in server.ts (local dev)
// are thin adapters that translate their native request/response into
// the plain shapes below and back — the actual page logic lives here
// once, shared by both runtimes, matching how createMcpServer() is
// shared for the MCP endpoint.
import {
  listProducts,
  getProduct,
  createProduct,
  updateProduct,
  deleteProduct,
  bulkCreateProducts,
  getInsights,
  type Product,
  type Insights,
} from "./db.js";
import { uploadImageFile } from "./storage.js";

export interface UploadedFile {
  filename: string;
  mimetype: string;
  data: Buffer;
}

export interface AdminRequest {
  method: string;
  action: string | undefined; // ?action=... query param
  edit?: string; // ?edit=<product id> query param — which row the form is editing
  body: Record<string, string>; // parsed form fields (POST only) — from either body encoding
  cookie: string | undefined; // the raw admin_session cookie value, if present
  // Present only on a multipart product submission — keyed by form field
  // name ("imageFile"), one entry per file actually included. The api/admin.ts (Vercel) and server.ts (local
  // dev) adapters parse multipart bodies themselves and hand the raw
  // bytes through here — this module never touches HTTP parsing directly.
  files?: Record<string, UploadedFile>;
}

export interface AdminResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
}

const COOKIE_NAME = "admin_session";

// A product photo renders well under 400px wide in the widget — a real
// report traced ChatGPT's widget sandbox not showing an image (while
// Claude's rendered it fine) to a 1.9MB, 1672x941 PNG straight off a
// phone, with no resizing anywhere in this upload path. There's no image
// library here to downsize server-side, so the cap is enforced instead:
// reject an oversized photo with a clear ask rather than silently
// accepting something that may not render everywhere.
const MAX_IMAGE_BYTES = 400 * 1024;

// Applies to every response from this module — an ordinary web page
// outside the MCP/ext-apps resource system, so it gets its own
// conventional security headers rather than reusing the widget's ui://
// CSP (which only ever applied to that one resource anyway).
const SECURITY_HEADERS: Record<string, string> = {
  "Content-Security-Policy": "default-src 'self'; style-src 'unsafe-inline'",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
};

function requireAdminToken(): string {
  const token = process.env.ADMIN_TOKEN?.trim();
  if (!token) {
    throw new Error("Set ADMIN_TOKEN in the environment before using /admin (see .env.example).");
  }
  return token;
}

function html(status: number, body: string, extraHeaders: Record<string, string> = {}): AdminResponse {
  return {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8", ...SECURITY_HEADERS, ...extraHeaders },
    body,
  };
}

function redirect(location: string, extraHeaders: Record<string, string> = {}): AdminResponse {
  return { status: 303, headers: { Location: location, ...SECURITY_HEADERS, ...extraHeaders }, body: "" };
}

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const PAGE_STYLE = `
  body { font: 14px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
         color: #262422; background: #fefdfc; margin: 0; padding: 32px 20px; }
  main { max-width: 760px; margin: 0 auto; }
  h1 { font-size: 20px; margin: 0 0 4px; }
  h2 { font-size: 15px; margin: 32px 0 10px; }
  p.sub { color: #6b665f; margin: 0 0 24px; font-size: 13px; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th, td { text-align: left; padding: 8px 10px; border-bottom: 1px solid #e7e2da; vertical-align: top; }
  th { color: #6b665f; font-weight: 600; }
  .empty { color: #6b665f; font-style: italic; }
  form.inline { display: inline; }
  label { display: block; margin-bottom: 12px; font-size: 13px; }
  label span { display: block; font-weight: 600; margin-bottom: 4px; }
  input[type=text], input[type=email], input[type=url], input[type=password] {
    font: inherit; width: 100%; max-width: 420px; padding: 7px 9px;
    border: 1px solid #d8d3cc; border-radius: 6px; box-sizing: border-box;
  }
  button, .btn { font: inherit; font-size: 13px; font-weight: 600; padding: 7px 12px;
    border-radius: 6px; border: 1px solid #d8d3cc; background: #fff; cursor: pointer; }
  button.danger { color: #c0392b; border-color: #e5b4ac; }
  button.primary { color: #fff; background: #b5541f; border-color: #b5541f; padding: 9px 18px; font-size: 14px; }
  .actions { margin-top: 8px; display: flex; gap: 8px; }
  .card { border: 1px solid #e7e2da; border-radius: 10px; padding: 16px; margin-bottom: 16px; }
  .checkbox-row { display: flex; align-items: center; gap: 8px; }
  .checkbox-row input { width: auto; }
  .error { color: #c0392b; font-size: 13px; margin: 0 0 16px; }
  .notice { background: #fdf3e9; border: 1px solid #edd3b3; border-radius: 8px;
    padding: 10px 12px; font-size: 12.5px; margin: 0 0 16px; }
`;

function page(title: string, body: string): string {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title><style>${PAGE_STYLE}</style></head><body><main>${body}</main></body></html>`;
}

function loginPage(error?: string): AdminResponse {
  return html(
    200,
    page(
      "Admin login",
      `
        <h1>Admin login</h1>
        <p class="sub">Enter the admin token to manage your recommendations.</p>
        ${error ? `<p class="error">${escapeHtml(error)}</p>` : ""}
        <form method="post" action="/admin?action=login">
          <label><span>Token</span><input type="password" name="token" required autofocus /></label>
          <button type="submit">Log in</button>
        </form>
      `,
    ),
  );
}

function isAuthed(req: AdminRequest): boolean {
  let token: string;
  try {
    token = requireAdminToken();
  } catch {
    return false;
  }
  return req.cookie === token;
}

// Minimal RFC 4180 escaping — quote a field if it contains a comma,
// quote, or newline, doubling any internal quotes.
function csvField(value: string): string {
  if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

function insightsToCsv(insights: Insights): string {
  const rows: string[][] = [["section", "label", "count"]];
  for (const q of insights.topQuestions) rows.push(["question", q.question, String(q.count)]);
  for (const q of insights.gaps) rows.push(["gap", q.question, String(q.count)]);
  for (const p of insights.products) {
    rows.push(["product_questions", p.name, String(p.questions)]);
    rows.push(["product_clicks", p.name, String(p.clicks)]);
  }
  return rows.map((r) => r.map(csvField).join(",")).join("\n") + "\n";
}

// Only http(s) links are ever stored. This is the same check the redirect
// relies on (api/redirect.ts sends people to whatever is stored here), so
// it's what keeps a "javascript:" or "data:" URL from being pasted into
// the catalog and handed to someone's browser as a purchase link.
function normalizeBuyUrl(raw: string): string | null {
  const value = raw.trim();
  if (!value) return null;
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return null;
  }
  return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.toString() : null;
}

// A pasted affiliate link carries no title, so guess a provisional name
// from its path just to make the draft findable in the table. The creator
// renames it when they write the blurb — this only has to be better than
// a row labelled with a bare URL.
function nameFromUrl(raw: string): string {
  try {
    const url = new URL(raw);
    const slug = url.pathname.split("/").filter(Boolean).pop() ?? "";
    const cleaned = slug.replace(/\.[a-z0-9]{2,4}$/i, "").replace(/[-_+]+/g, " ").trim();
    if (cleaned && !/^(dp|gp|product|item|ref)$/i.test(cleaned) && cleaned.length > 2) {
      return cleaned.replace(/\b\w/g, (c) => c.toUpperCase()).slice(0, 80);
    }
    return url.hostname.replace(/^www\./, "");
  } catch {
    return "Untitled";
  }
}

/**
 * Parses the bulk-import textarea. Accepts either a bare URL per line or
 * `name,url[,category]` CSV — creators paste from wildly different places
 * (an Amazon storefront, an LTK export, a notes app), and rejecting the
 * shape they happen to have is a worse failure than guessing a name.
 */
export function parseBulkImport(input: string): { name: string; buyUrl: string; category?: string | null }[] {
  const rows: { name: string; buyUrl: string; category?: string | null }[] = [];
  for (const line of input.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const parts = trimmed.split(",").map((p) => p.trim());
    const urlPart = parts.find((p) => normalizeBuyUrl(p));
    if (!urlPart) continue;
    const buyUrl = normalizeBuyUrl(urlPart)!;

    const before = parts.slice(0, parts.indexOf(urlPart)).filter(Boolean);
    const after = parts.slice(parts.indexOf(urlPart) + 1).filter(Boolean);
    rows.push({
      name: before.length ? before.join(", ") : nameFromUrl(buyUrl),
      buyUrl,
      category: after.length ? after[0] : null,
    });
  }
  return rows;
}

function field(label: string, name: string, value: string | null, opts: { type?: string; placeholder?: string; hint?: string } = {}): string {
  return `<label><span>${escapeHtml(label)}</span>` +
    `<input type="${opts.type ?? "text"}" name="${name}" value="${escapeHtml(value ?? "")}"` +
    `${opts.placeholder ? ` placeholder="${escapeHtml(opts.placeholder)}"` : ""} />` +
    `${opts.hint ? `<small style="color:#6b665f">${escapeHtml(opts.hint)}</small>` : ""}</label>`;
}

function productForm(product: Product | null): string {
  const action = product ? `/admin?action=edit-product` : `/admin?action=add-product`;
  return `
    <form method="post" action="${action}" enctype="multipart/form-data">
      ${product ? `<input type="hidden" name="id" value="${product.id}" />` : ""}
      ${field("Product name", "name", product?.name ?? null, { placeholder: "8-inch chef's knife" })}
      ${field("Brand", "brand", product?.brand ?? null, { placeholder: "Optional" })}
      ${field("Category", "category", product?.category ?? null, { placeholder: "kitchen" })}
      <label><span>Why you use it — in your words</span>
        <textarea name="blurb" rows="3" style="font:inherit;width:100%;max-width:420px;padding:7px 9px;border:1px solid #d8d3cc;border-radius:6px;box-sizing:border-box"
          placeholder="It's the one knife I reach for every day. Holds an edge and doesn't feel heavy.">${escapeHtml(product?.blurb ?? "")}</textarea>
        <small style="color:#6b665f">Shown on the card exactly as written. Nothing is generated for you.</small>
      </label>
      ${field("Who it's for", "audience", product?.audience ?? null, { placeholder: "Anyone cooking most nights" })}
      ${field("Match keywords", "keywords", product?.keywords ?? null, { placeholder: "chopping prep everyday cooking", hint: "Never shown. Extra words that should find this product." })}
      ${field("Buy link", "buyUrl", product?.buyUrl ?? null, { type: "url", placeholder: "https://…", hint: "Your affiliate link. Clicks route through /r/ so they can be counted." })}
      ${field("Price note", "priceNote", product?.priceNote ?? null, { placeholder: "~$180", hint: "Display only — never checked against the retailer." })}
      <label><span>Photo</span><input type="file" name="imageFile" accept="image/*" /></label>
      ${field("…or paste an image URL", "imageUrl", product?.imageUrl ?? null, { type: "url", hint: "Uploads are safer: pasted URLs only render if that host is on the widget's CSP allowlist." })}
      <div class="checkbox-row">
        <input type="checkbox" id="enabled" name="enabled" ${!product || product.enabled ? "checked" : ""} />
        <label for="enabled" style="margin:0"><span style="display:inline">Recommend this product</span></label>
      </div>
      <div class="actions"><button type="submit" class="primary">${product ? "Save changes" : "Add product"}</button>
      ${product ? `<a class="btn" href="/admin">Cancel</a>` : ""}</div>
    </form>`;
}

function productsTable(products: Product[]): string {
  if (products.length === 0) {
    return `<p class="empty">No products yet. Add one below, or paste a list of links to import.</p>`;
  }
  const rows = products.map((p) => `
    <tr>
      <td>${escapeHtml(p.name)}${p.brand ? `<br><small style="color:#6b665f">${escapeHtml(p.brand)}</small>` : ""}</td>
      <td>${escapeHtml(p.category ?? "")}</td>
      <td>${p.blurb ? escapeHtml(p.blurb.slice(0, 70)) + (p.blurb.length > 70 ? "…" : "") : `<span class="empty">needs a line</span>`}</td>
      <td>${p.enabled ? "Live" : "Draft"}</td>
      <td>
        <form class="inline" method="post" action="/admin?action=toggle-product">
          <input type="hidden" name="id" value="${p.id}" />
          <button type="submit">${p.enabled ? "Pause" : "Publish"}</button>
        </form>
        <a class="btn" href="/admin?edit=${p.id}">Edit</a>
        <form class="inline" method="post" action="/admin?action=delete-product">
          <input type="hidden" name="id" value="${p.id}" />
          <button type="submit" class="danger">Delete</button>
        </form>
      </td>
    </tr>`).join("");
  return `<table><thead><tr><th>Product</th><th>Category</th><th>Your line</th><th>Status</th><th></th></tr></thead><tbody>${rows}</tbody></table>`;
}

function countList(items: { question: string; count: number }[], emptyText: string): string {
  if (items.length === 0) return `<p class="empty">${escapeHtml(emptyText)}</p>`;
  const rows = items.map((i) =>
    `<tr><td>${escapeHtml(i.question)}</td><td style="text-align:right">${i.count}</td></tr>`).join("");
  return `<table><tbody>${rows}</tbody></table>`;
}

function insightsSection(insights: Insights): string {
  // Questions that ended in a click, over questions that had something
  // real to click — not raw clicks, which double-count repeat taps and
  // include demo-page clicks carrying no question. See Insights.questionsWithClick.
  const rate = insights.answeredQuestions > 0
    ? Math.round((insights.questionsWithClick / insights.answeredQuestions) * 100)
    : 0;
  const productRows = insights.products.length === 0
    ? `<p class="empty">Nothing asked for yet.</p>`
    : `<table><thead><tr><th>Product</th><th style="text-align:right">Asked for</th><th style="text-align:right">Clicks</th></tr></thead><tbody>` +
      insights.products.map((p) =>
        `<tr><td>${escapeHtml(p.name)}</td><td style="text-align:right">${p.questions}</td>` +
        `<td style="text-align:right">${p.clicks}</td></tr>`).join("") +
      `</tbody></table>`;

  return `
    <h2>What your audience is asking</h2>
    <p class="sub">${insights.totalQuestions} question${insights.totalQuestions === 1 ? "" : "s"} ·
      ${insights.totalClicks} click${insights.totalClicks === 1 ? "" : "s"} ·
      ${rate}% of the questions you had a pick for ended in a click.</p>

    <div class="card">
      <h2 style="margin-top:0">Most asked</h2>
      ${countList(insights.topQuestions, "No questions yet.")}
    </div>

    <div class="card">
      <h2 style="margin-top:0">Nothing good to recommend</h2>
      <p class="sub">Questions where you had no strong pick. Each one is a product your audience
        already wants and you aren't recommending yet.</p>
      ${countList(insights.gaps, "No gaps — everything asked for had a match.")}
    </div>

    <div class="card">
      <h2 style="margin-top:0">By product</h2>
      ${productRows}
    </div>

    <p><a class="btn" href="/admin?action=export">Export questions &amp; gaps (CSV)</a></p>`;
}

async function dashboardPage(editId?: number, error?: string): Promise<AdminResponse> {
  // Sequential, not Promise.all — confirmed live that firing these
  // queries concurrently over the single shared connection (max: 1) hangs
  // indefinitely against Supabase's pgbouncer transaction pooler (no
  // response, no error, no timeout — a real deadlock, not just slow).
  const products = await listProducts();
  const insights = await getInsights();
  const editing = editId === undefined ? null : await getProduct(editId);
  const drafts = products.filter((p) => !p.enabled).length;

  return html(
    200,
    page(
      "Recommendations",
      `
        <h1>Recommendations</h1>
        <p class="sub">What your plugin recommends when someone asks what you use.</p>
        ${error ? `<p class="error">${escapeHtml(error)}</p>` : ""}
        ${drafts > 0 ? `<p class="notice">${drafts} draft${drafts === 1 ? "" : "s"} still ${drafts === 1 ? "needs" : "need"} your line and a publish before ${drafts === 1 ? "it can" : "they can"} be recommended.</p>` : ""}

        <h2>Your catalog</h2>
        ${productsTable(products)}

        <h2>${editing ? "Edit product" : "Add a product"}</h2>
        <div class="card">${productForm(editing)}</div>

        <h2>Import a list</h2>
        <div class="card">
          <p class="sub">Paste your existing affiliate links — one per line, or
            <code>name, url, category</code>. Everything imports as a draft with no description,
            so nothing goes live until you've written your line for it.</p>
          <form method="post" action="/admin?action=bulk-import">
            <textarea name="list" rows="6" style="font:inherit;width:100%;padding:7px 9px;border:1px solid #d8d3cc;border-radius:6px;box-sizing:border-box"
              placeholder="https://amzn.to/xxxx&#10;Chef's knife, https://example.com/knife, kitchen"></textarea>
            <div class="actions"><button type="submit" class="primary">Import</button></div>
          </form>
        </div>

        ${insightsSection(insights)}

        <form method="post" action="/admin?action=logout" style="margin-top:32px">
          <button type="submit">Log out</button>
        </form>
      `,
    ),
  );
}

export async function handleAdminRequest(req: AdminRequest): Promise<AdminResponse> {
  requireAdminToken(); // fail fast with a clear message if misconfigured

  if (req.action === "login" && req.method === "POST") {
    const token = req.body.token?.trim();
    if (token && token === requireAdminToken()) {
      return redirect("/admin", {
        "Set-Cookie": `${COOKIE_NAME}=${encodeURIComponent(token)}; Path=/admin; HttpOnly; SameSite=Strict; Secure`,
      });
    }
    return loginPage("Incorrect token.");
  }

  if (req.action === "logout" && req.method === "POST") {
    return redirect("/admin", {
      "Set-Cookie": `${COOKIE_NAME}=; Path=/admin; HttpOnly; SameSite=Strict; Secure; Max-Age=0`,
    });
  }

  if (!isAuthed(req)) {
    return loginPage();
  }

  if (req.action === "export" && req.method === "GET") {
    const insights = await getInsights(500);
    return {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": 'attachment; filename="questions.csv"',
        ...SECURITY_HEADERS,
      },
      body: insightsToCsv(insights),
    };
  }

  if ((req.action === "add-product" || req.action === "edit-product") && req.method === "POST") {
    const editing = req.action === "edit-product";
    const id = Number(req.body.id);
    if (editing && !Number.isFinite(id)) return dashboardPage(undefined, "Unknown product.");

    const name = req.body.name?.trim();
    if (!name) return dashboardPage(editing ? id : undefined, "A product needs a name.");

    // Precedence for the photo: an upload wins, then a typed URL, then
    // whatever's already stored — an empty submit must not blank out a
    // working image.
    let imageUrl: string | null | undefined = req.body.imageUrl?.trim() || undefined;
    const imageFile = req.files?.imageFile;
    try {
      if (imageFile && imageFile.data.length > 0) {
        if (imageFile.data.length > MAX_IMAGE_BYTES) {
          const gotKb = Math.round(imageFile.data.length / 1024);
          const maxKb = Math.round(MAX_IMAGE_BYTES / 1024);
          return dashboardPage(
            editing ? id : undefined,
            `That photo is ${gotKb}KB — please resize it under ${maxKb}KB (a phone photo is usually ` +
            `1-2MB; most photo apps have a "resize" or "compress" option) and upload it again. ` +
            `Your other changes were not saved.`,
          );
        }
        imageUrl = await uploadImageFile(imageFile.data, imageFile.filename, imageFile.mimetype);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return dashboardPage(editing ? id : undefined, `Could not upload the photo: ${message}`);
    }

    const rawBuyUrl = req.body.buyUrl ?? "";
    const buyUrl = normalizeBuyUrl(rawBuyUrl);
    if (!editing && !buyUrl) {
      return dashboardPage(undefined, "A product needs a buy link starting with http:// or https://.");
    }
    if (editing && rawBuyUrl.trim() && !buyUrl) {
      return dashboardPage(id, "That buy link isn't a valid http:// or https:// URL.");
    }

    const fields = {
      name,
      brand: req.body.brand?.trim() || null,
      category: req.body.category?.trim() || null,
      blurb: req.body.blurb ?? "",
      audience: req.body.audience?.trim() || null,
      keywords: req.body.keywords?.trim() ?? "",
      priceNote: req.body.priceNote?.trim() || null,
      enabled: req.body.enabled === "on",
      ...(imageUrl !== undefined ? { imageUrl } : {}),
    };

    if (editing) {
      await updateProduct(id, { ...fields, ...(buyUrl ? { buyUrl } : {}) });
    } else {
      await createProduct({ ...fields, buyUrl: buyUrl! });
    }
    return redirect("/admin");
  }

  if (req.action === "toggle-product" && req.method === "POST") {
    const id = Number(req.body.id);
    if (Number.isFinite(id)) {
      const product = await getProduct(id);
      if (product) await updateProduct(id, { enabled: !product.enabled });
    }
    return redirect("/admin");
  }

  if (req.action === "delete-product" && req.method === "POST") {
    const id = Number(req.body.id);
    if (Number.isFinite(id)) await deleteProduct(id);
    return redirect("/admin");
  }

  if (req.action === "bulk-import" && req.method === "POST") {
    const rows = parseBulkImport(req.body.list ?? "");
    if (rows.length === 0) {
      return dashboardPage(undefined, "Nothing to import — no http:// or https:// links found in that list.");
    }
    await bulkCreateProducts(rows);
    return redirect("/admin");
  }

  if (req.method === "GET") {
    const editId = Number(req.edit ?? NaN);
    return dashboardPage(Number.isFinite(editId) ? editId : undefined);
  }

  return html(405, page("Not allowed", "<p>Method not allowed.</p>"));
}
