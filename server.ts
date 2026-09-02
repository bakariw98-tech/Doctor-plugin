// server.ts
// Local dev server: serves the MCP endpoint, the /api/recommend REST
// helper, the /r/<id> click redirect, and the static demo page
// (public/index.html) all from one Express app, mirroring what
// api/mcp.ts + api/recommend.ts + api/redirect.ts + public/ serve on
// Vercel.
console.log("Starting Creator Picks MCP App server...");

import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import Busboy from "busboy";
import cors from "cors";
import express from "express";
import path from "node:path";
import { createMcpServer } from "./src/mcp-server.js";
import { getProduct, logClick } from "./src/db.js";
import { pickProducts, toWire } from "./src/recommend.js";
import { resolveView, type ViewOption } from "./src/view.js";
import { handleAdminRequest, type AdminRequest, type UploadedFile } from "./src/admin.js";

// Local dev is the one deployment target that isn't Vercel, so it's the one
// place src/recommend.ts's siteOrigin() can't fall back to VERCEL_URL. Set a
// default here rather than leaving it unset: siteOrigin() now throws instead
// of silently degrading to relative /r/<id> links when neither this nor
// VERCEL_URL is present, so any *other* non-Vercel deployment target is
// forced to set PUBLIC_BASE_URL explicitly rather than shipping broken buy
// links to real chat clients with no error anywhere.
process.env.PUBLIC_BASE_URL ??= `http://localhost:${process.env.PORT ?? 3001}`;

const MAX_UPLOAD_BYTES = 4 * 1024 * 1024; // matches api/admin.ts — Vercel's request body cap, per file

// express.urlencoded()/json() below only consume bodies whose Content-Type
// they match, so a multipart product submission reaches this handler
// with its raw stream untouched — parse it the same way api/admin.ts does
// on Vercel, so local dev (npm run serve) behaves identically. Files are
// keyed by form field name ("imageFile"), one entry per file actually
// included.
function parseMultipart(req: express.Request): Promise<{ fields: Record<string, string>; files: Record<string, UploadedFile> }> {
  return new Promise((resolve, reject) => {
    const busboy = Busboy({ headers: req.headers as Record<string, string>, limits: { fileSize: MAX_UPLOAD_BYTES } });
    const fields: Record<string, string> = {};
    const files: Record<string, UploadedFile> = {};
    let tooLarge = false;

    busboy.on("field", (name, value) => {
      fields[name] = value;
    });
    busboy.on("file", (name, stream, info) => {
      const chunks: Buffer[] = [];
      stream.on("data", (chunk: Buffer) => chunks.push(chunk));
      stream.on("limit", () => {
        tooLarge = true;
      });
      stream.on("end", () => {
        if (!tooLarge && chunks.length) {
          files[name] = { filename: info.filename, mimetype: info.mimeType, data: Buffer.concat(chunks) };
        }
      });
    });
    busboy.on("error", reject);
    busboy.on("close", () => {
      if (tooLarge) {
        reject(new Error(`File too large — max ${MAX_UPLOAD_BYTES / (1024 * 1024)}MB. Host it elsewhere and paste a direct link instead.`));
        return;
      }
      resolve({ fields, files });
    });
    req.pipe(busboy);
  });
}

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: false })); // /admin's plain HTML forms
app.use(express.static(path.join(import.meta.dirname, "public")));

app.post("/mcp", async (req, res) => {
  const server = createMcpServer();
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  res.on("close", () => {
    transport.close();
    void server.close();
  });
  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
});

app.get("/api/recommend", async (req, res) => {
  const question = typeof req.query.q === "string" ? req.query.q.trim() : "";
  if (!question) {
    res.status(400).json({ error: "Missing required query parameter 'q'." });
    return;
  }
  const maxParam = req.query.max;
  const maxResults = typeof maxParam === "string" ? Number(maxParam) : undefined;
  const viewParam = typeof req.query.view === "string" ? (req.query.view as ViewOption) : undefined;

  try {
    const { products, quality } = await pickProducts(question, maxResults ?? 8);
    const view = resolveView(viewParam, products.length);
    res.status(200).json({
      question,
      view,
      matchQuality: quality,
      products: products.map((p) => toWire(p, null)),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

// Click redirect — mirrors api/redirect.ts. The destination is always
// looked up by id and never read from the request, so there's no open
// redirect here; see that file's header for the full reasoning.
app.get("/r/:id", async (req, res) => {
  const productId = Number(req.params.id);
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
    // Analytics must never cost a sale.
  }
  res.redirect(302, product.buyUrl);
});

async function adminHandler(req: express.Request, res: express.Response) {
  const action = typeof req.query.action === "string" ? req.query.action : undefined;
  const edit = typeof req.query.edit === "string" ? req.query.edit : undefined;
  try {
    let body: Record<string, string> = {};
    let files: AdminRequest["files"];
    if (req.method === "POST") {
      const contentType = req.headers["content-type"] ?? "";
      if (contentType.startsWith("multipart/form-data")) {
        ({ fields: body, files } = await parseMultipart(req));
      } else {
        body = req.body as Record<string, string>; // parsed by express.urlencoded() above
      }
    }
    const adminReq: AdminRequest = {
      method: req.method,
      action,
      edit,
      body,
      cookie: parseCookie(req.headers.cookie, "admin_session"),
      files,
    };
    const result = await handleAdminRequest(adminReq);
    for (const [key, value] of Object.entries(result.headers)) res.setHeader(key, value);
    res.status(result.status).send(result.body);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).send(`<p>Admin page error: ${message}</p>`);
  }
}

function parseCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return decodeURIComponent(rest.join("="));
  }
  return undefined;
}

app.get("/admin", adminHandler);
app.post("/admin", adminHandler);

const PORT = Number(process.env.PORT ?? 3001);
app.listen(PORT, () => {
  console.log(`Doctor YouTube MCP server listening on http://localhost:${PORT}/mcp`);
  console.log(`Demo page:                        http://localhost:${PORT}/`);
});
