// src/db.ts
// Postgres client for the lead-capture feature (offer_lead_magnet /
// submit_lead in src/mcp-server.ts, and the /admin dashboard in
// src/admin.ts). Everything here goes through a real database rather than
// process memory, because api/mcp.ts and api/admin.ts are stateless
// Vercel serverless functions — a fresh process per request, nothing
// survives between the "show form" call and the "submit form" call
// except what's actually persisted.
//
// Uses the plain `postgres` driver (porsager/postgres) against a Supabase
// project's connection string — Supabase, not Vercel's own Postgres/Neon
// storage integration, since that's the account/dashboard already in use
// here and there's no reason to introduce a second one. Any standard
// Postgres connection string works the same way, so this isn't
// Supabase-specific code, just a Supabase-sourced connection string.
//
// Requires a Supabase project (supabase.com — free tier is fine) set up
// once outside this repo; see .env.example and README.md. This module
// creates the tables inside that database, not the database itself.
//
// DEMO_MODE=1 (see isDemoMode below) skips the database entirely and
// keeps everything in an in-process Map instead — for trying out the
// offer/form UI itself before a real database is wired up. Deliberately
// opt-in (an explicit env var, not just "DATABASE_URL happens to be
// unset") so a genuinely misconfigured deployment fails loudly instead of
// silently pretending to collect leads it's actually throwing away every
// cold start.
import postgres from "postgres";

function isDemoMode(): boolean {
  return process.env.DEMO_MODE === "1";
}

function requireConnectionString(): string {
  const url = process.env.DATABASE_URL?.trim();
  if (!url) {
    throw new Error(
      "Set DATABASE_URL in the environment — create a Supabase project (supabase.com) and copy its " +
        "connection string first (see .env.example) — or set DEMO_MODE=1 to try the UI without a " +
        "database (leads won't be saved anywhere real; see the file header of src/db.ts).",
    );
  }
  return url;
}

let sqlClient: ReturnType<typeof postgres> | null = null;

function sql() {
  if (!sqlClient) {
    sqlClient = postgres(requireConnectionString(), {
      // One connection per serverless invocation rather than a pool —
      // this runs in a fresh process per request (see file header), so a
      // pool would just open connections it never gets to reuse.
      // Supabase's pooled "Transaction" connection string (recommended
      // for serverless, see README) proxies through pgbouncer, which
      // doesn't support prepared statements — turn them off so this
      // works against either connection string, not just the direct one.
      max: 1,
      prepare: false,
      // postgres.js normally fetches custom-type metadata from pg_catalog
      // on first connection and relies on a Describe round-trip to infer
      // each parameter's type. Both break through pgbouncer's transaction
      // pooling mode (confirmed live: even a plain `INSERT ... VALUES
      // (${text})` failed with "could not determine data type of
      // parameter $1"). Disabling type-fetching plus casting every
      // interpolated value explicitly below (::text/::boolean/::integer)
      // sidesteps both — Postgres never needs to ask the pooler for a
      // type it wasn't told.
      fetch_types: false,
    });
  }
  return sqlClient;
}

export interface MagnetConfig {
  enabled: boolean;
  title: string;
  description: string;
  resourceUrl: string;
  // Optional — a real image URL for the offer's cover art. Unset falls
  // back to a generated icon-and-gradient treatment in the UI rather than
  // a blank/broken image.
  coverImageUrl: string | null;
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
  coverImageUrl: null,
};

// ---- Demo mode: in-process store, no database at all -------------------

interface MemoryStore {
  config: MagnetConfig;
  questions: Question[];
  leads: Lead[];
  nextQuestionId: number;
  nextLeadId: number;
}

let memoryStore: MemoryStore | null = null;

function store(): MemoryStore {
  if (!memoryStore) {
    memoryStore = { config: { ...DEFAULT_MAGNET }, questions: [], leads: [], nextQuestionId: 1, nextLeadId: 1 };
  }
  return memoryStore;
}

// ---- Schema (real database only) ----------------------------------------

// Memoized per warm process so repeated calls in the same serverless
// instance don't re-run CREATE TABLE IF NOT EXISTS every time — but a
// fresh cold start (or the first call ever) always re-checks, so there's
// no manual migration step required for correctness (npm run migrate
// exists only as an optional manual convenience/connectivity check).
let schemaReady: Promise<void> | null = null;

async function ensureSchemaUncached(): Promise<void> {
  const db = sql();
  // The DEFAULT ... values below are cast explicitly (::text) rather than
  // left as bare parameters — Postgres can't infer a parameter's type from
  // a CREATE TABLE column DEFAULT clause the way it can from a normal
  // DML WHERE/VALUES context, and going through Supabase's pgbouncer
  // transaction pooler (prepare: false) surfaces that as "could not
  // determine data type of parameter $1" instead of silently working.
  await db`
    CREATE TABLE IF NOT EXISTS lead_magnet_config (
      id             SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
      enabled        BOOLEAN NOT NULL DEFAULT true,
      title          TEXT NOT NULL DEFAULT ${DEFAULT_MAGNET.title}::text,
      description    TEXT NOT NULL DEFAULT ${DEFAULT_MAGNET.description}::text,
      resource_url   TEXT NOT NULL DEFAULT ${DEFAULT_MAGNET.resourceUrl}::text,
      cover_image_url TEXT,
      updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;
  // Older deployments may already have the table without this column.
  await db`ALTER TABLE lead_magnet_config ADD COLUMN IF NOT EXISTS cover_image_url TEXT`;
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
  if (isDemoMode()) return Promise.resolve();
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
  cover_image_url: string | null;
}): MagnetConfig {
  return {
    enabled: row.enabled,
    title: row.title,
    description: row.description,
    resourceUrl: row.resource_url,
    coverImageUrl: row.cover_image_url,
  };
}

export async function getMagnetConfig(): Promise<MagnetConfig> {
  if (isDemoMode()) return store().config;
  await ensureSchema();
  const rows = await sql()`
    SELECT enabled, title, description, resource_url, cover_image_url FROM lead_magnet_config WHERE id = 1
  `;
  return rows[0] ? toMagnetConfig(rows[0] as never) : DEFAULT_MAGNET;
}

export async function updateMagnetConfig(input: Partial<MagnetConfig>): Promise<MagnetConfig> {
  if (isDemoMode()) {
    store().config = { ...store().config, ...input };
    return store().config;
  }
  await ensureSchema();
  const current = await getMagnetConfig();
  const next = { ...current, ...input };
  const rows = await sql()`
    UPDATE lead_magnet_config
    SET enabled = ${next.enabled}::boolean, title = ${next.title}::text, description = ${next.description}::text,
        resource_url = ${next.resourceUrl}::text, cover_image_url = ${next.coverImageUrl}::text, updated_at = now()
    WHERE id = 1
    RETURNING enabled, title, description, resource_url, cover_image_url
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
  if (isDemoMode()) return [...store().questions].sort((a, b) => a.sortOrder - b.sortOrder);
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
  if (isDemoMode()) {
    const s = store();
    const base = slugify(input.label);
    let fieldKey = base;
    for (let suffix = 2; s.questions.some((q) => q.fieldKey === fieldKey); suffix++) {
      fieldKey = `${base}_${suffix}`;
    }
    const question: Question = {
      id: s.nextQuestionId++,
      fieldKey,
      label: input.label,
      required: input.required,
      sortOrder: s.questions.length,
    };
    s.questions.push(question);
    return question;
  }

  await ensureSchema();
  const db = sql();
  const base = slugify(input.label);
  let fieldKey = base;
  for (let suffix = 2; ; suffix++) {
    const existing = await db`SELECT 1 FROM lead_form_questions WHERE field_key = ${fieldKey}::text`;
    if (existing.length === 0) break;
    fieldKey = `${base}_${suffix}`;
  }
  const [{ next_order }] = (await db`
    SELECT COALESCE(MAX(sort_order), 0) + 1 AS next_order FROM lead_form_questions
  `) as { next_order: number }[];

  const rows = await db`
    INSERT INTO lead_form_questions (label, field_key, required, sort_order)
    VALUES (${input.label}::text, ${fieldKey}::text, ${input.required}::boolean, ${next_order}::integer)
    RETURNING id, field_key, label, required, sort_order
  `;
  return toQuestion(rows[0] as never);
}

export async function deleteQuestion(id: number): Promise<void> {
  if (isDemoMode()) {
    const s = store();
    s.questions = s.questions.filter((q) => q.id !== id);
    return;
  }
  await ensureSchema();
  await sql()`DELETE FROM lead_form_questions WHERE id = ${id}::integer`;
}

export async function insertLead(input: {
  email: string;
  name: string | null;
  topic: string | null;
  answers: Record<string, string>;
}): Promise<Lead> {
  if (isDemoMode()) {
    const s = store();
    const lead: Lead = { id: s.nextLeadId++, ...input, createdAt: new Date().toISOString() };
    s.leads.unshift(lead);
    return lead;
  }

  await ensureSchema();
  const rows = await sql()`
    INSERT INTO leads (email, name, topic, answers)
    VALUES (${input.email}::text, ${input.name}::text, ${input.topic}::text, ${JSON.stringify(input.answers)}::jsonb)
    RETURNING id, email, name, topic, answers, created_at
  `;
  const row = rows[0] as { id: number; email: string; name: string | null; topic: string | null; answers: Record<string, string>; created_at: string };
  return { id: row.id, email: row.email, name: row.name, topic: row.topic, answers: row.answers, createdAt: row.created_at };
}

export async function listLeads(): Promise<Lead[]> {
  if (isDemoMode()) return store().leads;
  await ensureSchema();
  const rows = await sql()`
    SELECT id, email, name, topic, answers, created_at FROM leads ORDER BY created_at DESC
  `;
  return rows.map((r) => {
    const row = r as { id: number; email: string; name: string | null; topic: string | null; answers: Record<string, string>; created_at: string };
    return { id: row.id, email: row.email, name: row.name, topic: row.topic, answers: row.answers, createdAt: row.created_at };
  });
}
