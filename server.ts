// server.ts
// Local dev server: serves the MCP endpoint, the /api/search REST helper,
// and the static demo page (public/index.html) all from one Express app,
// mirroring what api/mcp.ts + api/search.ts + public/ serve on Vercel.
console.log("Starting Doctor YouTube MCP App server...");

import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import Busboy from "busboy";
import cors from "cors";
import express from "express";
import path from "node:path";
import { createMcpServer } from "./src/mcp-server.js";
import { searchChannelVideos } from "./src/youtube.js";
import { resolveView, type ViewOption } from "./src/view.js";
import { handleAdminRequest, type AdminRequest, type UploadedFile } from "./src/admin.js";

const MAX_UPLOAD_BYTES = 4 * 1024 * 1024; // matches api/admin.ts — Vercel's request body cap, per file

// express.urlencoded()/json() below only consume bodies whose Content-Type
// they match, so a multipart save-config submission reaches this handler
// with its raw stream untouched — parse it the same way api/admin.ts does
// on Vercel, so local dev (npm run serve) behaves identically. Files are
// keyed by form field name ("resourceFile", "coverImageFile"), one entry
// per file actually included.
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

app.get("/api/search", async (req, res) => {
  const query = typeof req.query.q === "string" ? req.query.q.trim() : "";
  if (!query) {
    res.status(400).json({ error: "Missing required query parameter 'q'." });
    return;
  }
  const maxParam = req.query.max;
  const maxResults = typeof maxParam === "string" ? Number(maxParam) : undefined;
  const viewParam = typeof req.query.view === "string" ? (req.query.view as ViewOption) : undefined;

  try {
    const videos = await searchChannelVideos(query, maxResults ?? 8);
    const view = resolveView(viewParam, videos.length);
    res.status(200).json({ query, view, videos });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

async function adminHandler(req: express.Request, res: express.Response) {
  const action = typeof req.query.action === "string" ? req.query.action : undefined;
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
