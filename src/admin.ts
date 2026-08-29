// src/admin.ts
// Runtime-agnostic logic for the /admin dashboard — the channel owner's
// simple, password-protected page to view/export leads and configure the
// lead magnet + form questions. This is a plain HTTP page, NOT part of
// the MCP protocol/widget — separate from the ui:// resource's CSP
// entirely (see the header comment in api/admin.ts).
//
// Deliberately not enterprise-grade auth: a single shared ADMIN_TOKEN
// compared against a cookie value. Good enough for "the channel owner has
// one link only they know," not a real multi-user auth system — treat
// ADMIN_TOKEN as a real credential (long, random) since anyone who has it
// can read every lead.
//
// api/admin.ts (Vercel) and the /admin routes in server.ts (local dev)
// are thin adapters that translate their native request/response into
// the plain shapes below and back — the actual page logic lives here
// once, shared by both runtimes, matching how createMcpServer() is
// shared for the MCP endpoint.
import {
  getMagnetConfig,
  updateMagnetConfig,
  listQuestions,
  addQuestion,
  deleteQuestion,
  listLeads,
  type Lead,
} from "./db.js";

export interface AdminRequest {
  method: string;
  action: string | undefined; // ?action=... query param
  body: Record<string, string>; // parsed application/x-www-form-urlencoded body (POST only)
  cookie: string | undefined; // the raw admin_session cookie value, if present
}

export interface AdminResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
}

const COOKIE_NAME = "admin_session";

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
  .actions { margin-top: 8px; display: flex; gap: 8px; }
  .card { border: 1px solid #e7e2da; border-radius: 10px; padding: 16px; margin-bottom: 16px; }
  .checkbox-row { display: flex; align-items: center; gap: 8px; }
  .checkbox-row input { width: auto; }
  .error { color: #c0392b; font-size: 13px; margin: 0 0 16px; }
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
        <p class="sub">Enter the admin token to view leads and manage the free-resource offer.</p>
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

function leadsToCsv(leads: Lead[]): string {
  const answerKeys = [...new Set(leads.flatMap((l) => Object.keys(l.answers)))];
  const header = ["id", "email", "name", "topic", "created_at", ...answerKeys];
  const rows = leads.map((l) =>
    [
      String(l.id),
      l.email,
      l.name ?? "",
      l.topic ?? "",
      l.createdAt,
      ...answerKeys.map((k) => l.answers[k] ?? ""),
    ]
      .map(csvField)
      .join(","),
  );
  return [header.map(csvField).join(","), ...rows].join("\n") + "\n";
}

async function dashboardPage(): Promise<AdminResponse> {
  const [leads, config, questions] = await Promise.all([listLeads(), getMagnetConfig(), listQuestions()]);

  const leadRows = leads.length
    ? leads
        .map(
          (l) => `
            <tr>
              <td>${escapeHtml(l.email)}</td>
              <td>${escapeHtml(l.name ?? "")}</td>
              <td>${escapeHtml(l.topic ?? "")}</td>
              <td>${Object.entries(l.answers).map(([k, v]) => `${escapeHtml(k)}: ${escapeHtml(v)}`).join("<br>")}</td>
              <td>${new Date(l.createdAt).toLocaleString()}</td>
            </tr>
          `,
        )
        .join("")
    : `<tr><td colspan="5" class="empty">No leads yet.</td></tr>`;

  const questionRows = questions.length
    ? questions
        .map(
          (q) => `
            <tr>
              <td>${escapeHtml(q.label)}</td>
              <td><code>${escapeHtml(q.fieldKey)}</code></td>
              <td>${q.required ? "Yes" : "No"}</td>
              <td>
                <form class="inline" method="post" action="/admin?action=delete-question">
                  <input type="hidden" name="id" value="${q.id}" />
                  <button type="submit" class="danger">Remove</button>
                </form>
              </td>
            </tr>
          `,
        )
        .join("")
    : `<tr><td colspan="4" class="empty">No extra questions configured — the form is just email + name.</td></tr>`;

  return html(
    200,
    page(
      "Leads dashboard",
      `
        <h1>Leads dashboard</h1>
        <p class="sub">
          ${leads.length} lead${leads.length === 1 ? "" : "s"} captured.
          <a class="btn" href="/admin?action=export">Download CSV</a>
          <form class="inline" method="post" action="/admin?action=logout"><button type="submit">Log out</button></form>
        </p>

        <h2>Leads</h2>
        <table>
          <thead><tr><th>Email</th><th>Name</th><th>Topic</th><th>Answers</th><th>Submitted</th></tr></thead>
          <tbody>${leadRows}</tbody>
        </table>

        <h2>Free resource offer</h2>
        <div class="card">
          <form method="post" action="/admin?action=save-config">
            <div class="checkbox-row">
              <input type="checkbox" id="enabled" name="enabled" ${config.enabled ? "checked" : ""} />
              <label for="enabled" style="margin:0;"><span style="margin:0;">Offer enabled</span></label>
            </div>
            <label><span>Title</span><input type="text" name="title" value="${escapeHtml(config.title)}" required /></label>
            <label><span>Description</span><input type="text" name="description" value="${escapeHtml(config.description)}" required /></label>
            <label><span>Resource URL</span><input type="url" name="resourceUrl" value="${escapeHtml(config.resourceUrl)}" required /></label>
            <button type="submit">Save</button>
          </form>
        </div>

        <h2>Extra form questions</h2>
        <p class="sub">Every submission always asks for email + name. These are added on top — kept in the same order they're added.</p>
        <table>
          <thead><tr><th>Label</th><th>Field key</th><th>Required</th><th></th></tr></thead>
          <tbody>${questionRows}</tbody>
        </table>
        <div class="card">
          <form method="post" action="/admin?action=add-question">
            <label><span>Question label</span><input type="text" name="label" placeholder="e.g. What's your biggest challenge?" required /></label>
            <div class="checkbox-row">
              <input type="checkbox" id="required" name="required" />
              <label for="required" style="margin:0;"><span style="margin:0;">Required</span></label>
            </div>
            <div class="actions"><button type="submit">Add question</button></div>
          </form>
        </div>
      `,
    ),
  );
}

/**
 * Handles one /admin request end to end, given a runtime-agnostic
 * AdminRequest. The api/admin.ts (Vercel) and server.ts (local dev)
 * adapters translate their native req/res into this shape and back.
 */
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
    const leads = await listLeads();
    return {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": 'attachment; filename="leads.csv"',
        ...SECURITY_HEADERS,
      },
      body: leadsToCsv(leads),
    };
  }

  if (req.action === "save-config" && req.method === "POST") {
    await updateMagnetConfig({
      enabled: req.body.enabled === "on",
      title: req.body.title ?? "",
      description: req.body.description ?? "",
      resourceUrl: req.body.resourceUrl ?? "",
    });
    return redirect("/admin");
  }

  if (req.action === "add-question" && req.method === "POST") {
    const label = req.body.label?.trim();
    if (label) {
      await addQuestion({ label, required: req.body.required === "on" });
    }
    return redirect("/admin");
  }

  if (req.action === "delete-question" && req.method === "POST") {
    const id = Number(req.body.id);
    if (Number.isFinite(id)) await deleteQuestion(id);
    return redirect("/admin");
  }

  if (req.method === "GET") {
    return dashboardPage();
  }

  return html(405, page("Not allowed", "<p>Method not allowed.</p>"));
}
