// src/db.ts
// Postgres client for the lead-capture feature (offer_lead_magnet /
// submit_lead in src/mcp-server.ts, and the /admin dashboard in
// src/admin.ts). Everything here goes through a real database rather than
// process memory, because api/mcp.ts and api/admin.ts are stateless
// Vercel serverless functions — a fresh process per request, nothing
// survives between the "show form" call and the "submit form" call
// except what's actually persisted.
//
// Uses @neondatabase/serverless's HTTP-based `neon()` client rather than
// @vercel/postgres (deprecated as of writing, in favor of Neon's own SDK —
// npm warns about this directly) or a pooled TCP client (unnecessary and
// awkward in a request-per-invocation serverless function).
//
// Requires a Postgres database provisioned via the Vercel dashboard
// (Storage -> Create Database -> Postgres/Neon) — that's a manual,
// one-time step outside this repo; see .env.example and README.md. This
// module cannot create the database itself, only the tables inside it.
import { neon } from "@neondatabase/serverless";

// Vercel's Neon integration has used a couple of different env var names
// across versions (DATABASE_URL is Neon's own convention; POSTGRES_URL is
// what the older @vercel/postgres integration set and some Neon setups
// still mirror it for back-compat) — check both rather than assuming one.
function requireConnectionString(): string {
  const url = process.env.DATABASE_URL?.trim() || process.env.POSTGRES_URL?.trim();
  if (!url) {
    throw new Error(
      "Set DATABASE_URL (or POSTGRES_URL) in the environment — provision a Postgres database via " +
        "the Vercel dashboard (Storage -> Create Database) first. See .env.example.",
    );
  }
  return url;
}

// Pin the generic params (row objects, not arrays; not the "full results
// with metadata" shape) so every query's result type is a plain
// Record<string, any>[] instead of a union TypeScript can't narrow.
let sqlClient: ReturnType<typeof neon<false, false>> | null = null;

function sql() {
  if (!sqlClient) sqlClient = neon<false, false>(requireConnectionString());
  return sqlClient;
}

export interface MagnetConfig {
  enabled: boolean;
  title: string;
  description: string;
  resourceUrl: string;
}

export interface Question {
  id: number;
  fieldKey: string;
  label: string;
  required: boolean;
  sortOrder: number;
}

export interface Lead {
  id: number;
  email: string;
  name: string | null;
  topic: string | null;
  answers: Record<string, string>;
  createdAt: string;
}

// Placeholder content until the creator sets real values via /admin — the
// mechanism should work end to end before any real PDF exists.
const DEFAULT_MAGNET: MagnetConfig = {
  enabled: true,
  title: "Free Guide",
  description: "A free resource related to what you searched for.",
  resourceUrl: "https://example.com/placeholder.pdf",
};

// Memoized per warm process so repeated calls in the same serverless
// instance don't re-run CREATE TABLE IF NOT EXISTS every time — but a
// fresh cold start (or the first call ever) always re-checks, so there's
// no manual migration step required for correctness (npm run migrate
// exists only as an optional manual convenience/connectivity check).
let schemaReady: Promise<void> | null = null;

async function ensureSchemaUncached(): Promise<void> {
  const db = sql();
  await db`
    CREATE TABLE IF NOT EXISTS lead_magnet_config (
      id           SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
      enabled      BOOLEAN NOT NULL DEFAULT true,
      title        TEXT NOT NULL DEFAULT ${DEFAULT_MAGNET.title},
      description  TEXT NOT NULL DEFAULT ${DEFAULT_MAGNET.description},
      resource_url TEXT NOT NULL DEFAULT ${DEFAULT_MAGNET.resourceUrl},
      updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;
  await db`INSERT INTO lead_magnet_config (id) VALUES (1) ON CONFLICT (id) DO NOTHING`;

  await db`
    CREATE TABLE IF NOT EXISTS lead_form_questions (
      id         SERIAL PRIMARY KEY,
      label      TEXT NOT NULL,
      field_key  TEXT NOT NULL UNIQUE,
      required   BOOLEAN NOT NULL DEFAULT false,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;

  await db`
    CREATE TABLE IF NOT EXISTS leads (
      id         SERIAL PRIMARY KEY,
      email      TEXT NOT NULL,
      name       TEXT,
      topic      TEXT,
      answers    JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;
  await db`CREATE INDEX IF NOT EXISTS leads_created_at_idx ON leads (created_at DESC)`;
}

export function ensureSchema(): Promise<void> {
  if (!schemaReady) {
    schemaReady = ensureSchemaUncached().catch((err) => {
      // A failed attempt shouldn't be cached — the next call gets a fresh
      // try instead of permanently failing for the life of the process.
      schemaReady = null;
      throw err;
    });
  }
  return schemaReady;
}

function toMagnetConfig(row: {
  enabled: boolean;
  title: string;
  description: string;
  resource_url: string;
}): MagnetConfig {
  return { enabled: row.enabled, title: row.title, description: row.description, resourceUrl: row.resource_url };
}

export async function getMagnetConfig(): Promise<MagnetConfig> {
  await ensureSchema();
  const rows = await sql()`SELECT enabled, title, description, resource_url FROM lead_magnet_config WHERE id = 1`;
  return rows[0] ? toMagnetConfig(rows[0] as never) : DEFAULT_MAGNET;
}

export async function updateMagnetConfig(input: Partial<MagnetConfig>): Promise<MagnetConfig> {
  await ensureSchema();
  const current = await getMagnetConfig();
  const next = { ...current, ...input };
  const rows = await sql()`
    UPDATE lead_magnet_config
    SET enabled = ${next.enabled}, title = ${next.title}, description = ${next.description},
        resource_url = ${next.resourceUrl}, updated_at = now()
    WHERE id = 1
    RETURNING enabled, title, description, resource_url
  `;
  return toMagnetConfig(rows[0] as never);
}

function toQuestion(row: {
  id: number;
  field_key: string;
  label: string;
  required: boolean;
  sort_order: number;
}): Question {
  return { id: row.id, fieldKey: row.field_key, label: row.label, required: row.required, sortOrder: row.sort_order };
}

export async function listQuestions(): Promise<Question[]> {
  await ensureSchema();
  const rows = await sql()`
    SELECT id, field_key, label, required, sort_order FROM lead_form_questions ORDER BY sort_order, id
  `;
  return rows.map((r) => toQuestion(r as never));
}

// Derives a stable, unique field_key from a label (e.g. "What's your
// goal?" -> "whats_your_goal") — this is what ties a dynamically-added
// question to its answer in leads.answers jsonb, independent of the
// label's own text so renaming a question later doesn't disturb
// historical leads recorded under the old key.
function slugify(label: string): string {
  const base = label
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return base || "question";
}

export async function addQuestion(input: { label: string; required: boolean }): Promise<Question> {
  await ensureSchema();
  const db = sql();
  const base = slugify(input.label);
  let fieldKey = base;
  for (let suffix = 2; ; suffix++) {
    const existing = await db`SELECT 1 FROM lead_form_questions WHERE field_key = ${fieldKey}`;
    if (existing.length === 0) break;
    fieldKey = `${base}_${suffix}`;
  }
  const [{ next_order }] = (await db`
    SELECT COALESCE(MAX(sort_order), 0) + 1 AS next_order FROM lead_form_questions
  `) as { next_order: number }[];

  const rows = await db`
    INSERT INTO lead_form_questions (label, field_key, required, sort_order)
    VALUES (${input.label}, ${fieldKey}, ${input.required}, ${next_order})
    RETURNING id, field_key, label, required, sort_order
  `;
  return toQuestion(rows[0] as never);
}

export async function deleteQuestion(id: number): Promise<void> {
  await ensureSchema();
  await sql()`DELETE FROM lead_form_questions WHERE id = ${id}`;
}

export async function insertLead(input: {
  email: string;
  name: string | null;
  topic: string | null;
  answers: Record<string, string>;
}): Promise<Lead> {
  await ensureSchema();
  const rows = await sql()`
    INSERT INTO leads (email, name, topic, answers)
    VALUES (${input.email}, ${input.name}, ${input.topic}, ${JSON.stringify(input.answers)}::jsonb)
    RETURNING id, email, name, topic, answers, created_at
  `;
  const row = rows[0] as { id: number; email: string; name: string | null; topic: string | null; answers: Record<string, string>; created_at: string };
  return { id: row.id, email: row.email, name: row.name, topic: row.topic, answers: row.answers, createdAt: row.created_at };
}

export async function listLeads(): Promise<Lead[]> {
  await ensureSchema();
  const rows = await sql()`
    SELECT id, email, name, topic, answers, created_at FROM leads ORDER BY created_at DESC
  `;
  return rows.map((r) => {
    const row = r as { id: number; email: string; name: string | null; topic: string | null; answers: Record<string, string>; created_at: string };
    return { id: row.id, email: row.email, name: row.name, topic: row.topic, answers: row.answers, createdAt: row.created_at };
  });
}
