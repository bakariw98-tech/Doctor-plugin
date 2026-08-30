// api/admin.ts
// The leads dashboard, as a Vercel serverless function. Deployed at
// /api/admin (also reachable at /admin via the rewrite in vercel.json).
// An ordinary HTTP page, not part of the MCP protocol — see src/admin.ts
// for the actual logic and why it has its own security headers separate
// from the widget's ui:// CSP.
import type { VercelRequest, VercelResponse } from "@vercel/node";
import Busboy from "busboy";
import { handleAdminRequest, type AdminRequest, type UploadedFile } from "../src/admin.js";

// The save-config form uploads files (multipart/form-data), which
// Vercel's automatic body parser doesn't handle — bodyParser is turned
// off entirely here so both multipart and the plain
// application/x-www-form-urlencoded forms (login, add-question, ...) are
// parsed the same way below, from the raw request stream.
export const config = { api: { bodyParser: false } };

const MAX_UPLOAD_BYTES = 4 * 1024 * 1024; // stay under Vercel's request body cap, per file

interface ParsedBody {
  fields: Record<string, string>;
  files: Record<string, UploadedFile>;
}

async function readRawBody(req: VercelRequest): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}

function parseMultipart(req: VercelRequest): Promise<ParsedBody> {
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

async function parseRequest(req: VercelRequest): Promise<ParsedBody> {
  const contentType = req.headers["content-type"] ?? "";
  if (contentType.startsWith("multipart/form-data")) {
    return parseMultipart(req);
  }
  // application/x-www-form-urlencoded (the login/add-question/etc. forms)
  const raw = (await readRawBody(req)).toString("utf8");
  const fields: Record<string, string> = {};
  for (const [key, value] of new URLSearchParams(raw)) fields[key] = value;
  return { fields, files: {} };
}

function parseCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return decodeURIComponent(rest.join("="));
  }
  return undefined;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const action = typeof req.query.action === "string" ? req.query.action : undefined;

  try {
    const { fields, files } = req.method === "POST" ? await parseRequest(req) : { fields: {}, files: {} };
    const adminReq: AdminRequest = {
      method: req.method ?? "GET",
      action,
      body: fields,
      cookie: parseCookie(req.headers.cookie, "admin_session"),
      files,
    };

    const result = await handleAdminRequest(adminReq);
    for (const [key, value] of Object.entries(result.headers)) {
      res.setHeader(key, value);
    }
    res.status(result.status).send(result.body);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).send(`<p>Admin page error: ${message}</p>`);
  }
}
