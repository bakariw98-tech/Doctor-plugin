// src/db.ts
// Postgres client for the product catalog (recommend_product /
// list_recommendations in src/mcp-server.ts, the /admin dashboard in
// src/admin.ts, and the click redirect in api/redirect.ts). Everything
// goes through a real database rather than process memory, because
// api/mcp.ts, api/admin.ts and api/redirect.ts are stateless Vercel
// serverless functions — a fresh process per request, nothing survives
// between the call that recommends a product and the click that follows
// it except what's actually persisted.
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
// Unlike the lead capture this replaced, the catalog is not optional —
// with no products there is nothing to recommend, so DATABASE_URL is now
// required for the app's core function rather than just one feature.
// DEMO_MODE=1 (see isDemoMode below) still skips the database entirely
// and keeps everything in an in-process Map, for trying the flow out
// before a real database is wired up. Deliberately opt-in (an explicit
// env var, not just "DATABASE_URL happens to be unset") so a genuinely
// misconfigured deployment fails loudly instead of silently serving an
// empty catalog and losing every click it should have counted.
import postgres from "postgres";

function isDemoMode(): boolean {
  return process.env.DEMO_MODE === "1";
}

function requireConnectionString(): string {
  const url = process.env.DATABASE_URL?.trim();
  if (!url) {
    throw new Error(
      "Set DATABASE_URL in the environment — create a Supabase project (supabase.com) and copy its " +
        "connection string first (see .env.example) — or set DEMO_MODE=1 to try the flow without a " +
        "database (nothing is saved anywhere real; see the file header of src/db.ts).",
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

// ── Types ────────────────────────────────────────────────────────────────

export interface Product {
  id: number;
  name: string;
  brand: string | null;
  category: string | null;
  /** The creator's own words on why they use it. Never model-generated. */
  blurb: string;
  /** Who it's for, in the creator's words. */
  audience: string | null;
  /** Extra free-text match terms that don't belong in the visible copy. */
  keywords: string;
  buyUrl: string;
  imageUrl: string | null;
  /** Display-only, e.g. "~$180". Never scraped, never authoritative. */
  priceNote: string | null;
  /** Optional promo/discount code shown with the buy button. */
  promoCode: string | null;
  /**
   * What this solves, in the creator's words. Never rendered — it exists so
   * a goal-shaped question ("trying to get into cooking more") has
   * need-shaped text to match against instead of only product nouns.
   */
  problem: string | null;
  /** How they actually use it. Feeds matching, the model, and the card's expandable. */
  usage: string | null;
  enabled: boolean;
  /**
   * Last verdict from src/linkcheck.ts. Null until the link has ever been
   * checked. Deliberately not part of ProductInput — the creator edits
   * their catalog, the checker edits this, and neither should be able to
   * clobber the other's column.
   */
  linkStatus: LinkStatus | null;
  linkCheckedAt: string | null;
  linkHttpStatus: number | null;
  linkNote: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * "unknown" is not a soft "dead" — it means the check was inconclusive
 * (merchant blocked us, timed out, 5xx'd). See src/linkcheck.ts for why
 * that distinction is the whole point of the feature.
 */
export type LinkStatus = "ok" | "dead" | "unknown";

export type MatchQuality = "strong" | "weak" | "none";

export interface ProductQuestion {
  id: number;
  question: string;
  productId: number | null;
  matchQuality: MatchQuality;
  createdAt: string;
}

export interface ProductInput {
  name: string;
  brand?: string | null;
  category?: string | null;
  blurb?: string;
  audience?: string | null;
  keywords?: string;
  buyUrl: string;
  imageUrl?: string | null;
  priceNote?: string | null;
  promoCode?: string | null;
  problem?: string | null;
  usage?: string | null;
  enabled?: boolean;
}

// ── Demo-mode in-memory store ────────────────────────────────────────────

interface MemoryStore {
  products: Product[];
  questions: ProductQuestion[];
  clicks: { productId: number; questionId: number | null; createdAt: string }[];
  nextProductId: number;
  nextQuestionId: number;
}

const globalStore = globalThis as unknown as { __catalogStore?: MemoryStore };

function store(): MemoryStore {
  if (!globalStore.__catalogStore) {
    globalStore.__catalogStore = {
      products: [],
      questions: [],
      clicks: [],
      nextProductId: 1,
      nextQuestionId: 1,
    };
  }
  return globalStore.__catalogStore;
}

// ── Schema ───────────────────────────────────────────────────────────────

let schemaReady: Promise<void> | null = null;

async function ensureSchemaUncached(): Promise<void> {
  const db = sql();
  await db`
    CREATE TABLE IF NOT EXISTS products (
      id         SERIAL PRIMARY KEY,
      name       TEXT NOT NULL,
      brand      TEXT,
      category   TEXT,
      blurb      TEXT NOT NULL DEFAULT '',
      audience   TEXT,
      keywords   TEXT NOT NULL DEFAULT '',
      buy_url    TEXT NOT NULL,
      image_url  TEXT,
      price_note TEXT,
      promo_code TEXT,
      problem    TEXT,
      usage      TEXT,
      enabled    BOOLEAN NOT NULL DEFAULT true,
      link_status      TEXT,
      link_checked_at  TIMESTAMPTZ,
      link_http_status INTEGER,
      link_note        TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;
  // Older deployments already have the table without these columns.
  await db`ALTER TABLE products ADD COLUMN IF NOT EXISTS promo_code TEXT`;
  await db`ALTER TABLE products ADD COLUMN IF NOT EXISTS problem TEXT`;
  await db`ALTER TABLE products ADD COLUMN IF NOT EXISTS usage TEXT`;
  await db`ALTER TABLE products ADD COLUMN IF NOT EXISTS link_status TEXT`;
  await db`ALTER TABLE products ADD COLUMN IF NOT EXISTS link_checked_at TIMESTAMPTZ`;
  await db`ALTER TABLE products ADD COLUMN IF NOT EXISTS link_http_status INTEGER`;
  await db`ALTER TABLE products ADD COLUMN IF NOT EXISTS link_note TEXT`;
  await db`CREATE INDEX IF NOT EXISTS products_enabled_idx ON products (enabled)`;

  await db`
    CREATE TABLE IF NOT EXISTS product_questions (
      id            SERIAL PRIMARY KEY,
      question      TEXT NOT NULL,
      product_id    INTEGER REFERENCES products(id) ON DELETE SET NULL,
      match_quality TEXT NOT NULL,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;
  await db`CREATE INDEX IF NOT EXISTS product_questions_created_at_idx ON product_questions (created_at DESC)`;

  await db`
    CREATE TABLE IF NOT EXISTS product_clicks (
      id          SERIAL PRIMARY KEY,
      product_id  INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      question_id INTEGER REFERENCES product_questions(id) ON DELETE SET NULL,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;
  await db`CREATE INDEX IF NOT EXISTS product_clicks_product_id_idx ON product_clicks (product_id)`;
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

// ── Row mapping ──────────────────────────────────────────────────────────

function toProduct(row: Record<string, unknown>): Product {
  return {
    id: Number(row.id),
    name: String(row.name),
    brand: (row.brand as string | null) ?? null,
    category: (row.category as string | null) ?? null,
    blurb: String(row.blurb ?? ""),
    audience: (row.audience as string | null) ?? null,
    keywords: String(row.keywords ?? ""),
    buyUrl: String(row.buy_url),
    imageUrl: (row.image_url as string | null) ?? null,
    priceNote: (row.price_note as string | null) ?? null,
    promoCode: (row.promo_code as string | null) ?? null,
    problem: (row.problem as string | null) ?? null,
    usage: (row.usage as string | null) ?? null,
    enabled: Boolean(row.enabled),
    linkStatus: (row.link_status as LinkStatus | null) ?? null,
    linkCheckedAt: row.link_checked_at ? new Date(row.link_checked_at as string).toISOString() : null,
    linkHttpStatus: row.link_http_status === null || row.link_http_status === undefined
      ? null
      : Number(row.link_http_status),
    linkNote: (row.link_note as string | null) ?? null,
    createdAt: new Date(row.created_at as string).toISOString(),
    updatedAt: new Date(row.updated_at as string).toISOString(),
  };
}

// ── Products ─────────────────────────────────────────────────────────────

export async function listProducts(opts: { enabledOnly?: boolean } = {}): Promise<Product[]> {
  if (isDemoMode()) {
    const all = [...store().products].sort((a, b) => a.name.localeCompare(b.name));
    return opts.enabledOnly ? all.filter((p) => p.enabled) : all;
  }
  await ensureSchema();
  const db = sql();
  const rows = opts.enabledOnly
    ? await db`SELECT * FROM products WHERE enabled = true ORDER BY name ASC`
    : await db`SELECT * FROM products ORDER BY name ASC`;
  return rows.map((r) => toProduct(r as Record<string, unknown>));
}

export async function getProduct(id: number): Promise<Product | null> {
  if (isDemoMode()) return store().products.find((p) => p.id === id) ?? null;
  await ensureSchema();
  const db = sql();
  const rows = await db`SELECT * FROM products WHERE id = ${id}::integer`;
  return rows.length ? toProduct(rows[0] as Record<string, unknown>) : null;
}

export async function createProduct(input: ProductInput): Promise<Product> {
  if (isDemoMode()) {
    const s = store();
    const now = new Date().toISOString();
    const product: Product = {
      id: s.nextProductId++,
      name: input.name,
      brand: input.brand ?? null,
      category: input.category ?? null,
      blurb: input.blurb ?? "",
      audience: input.audience ?? null,
      keywords: input.keywords ?? "",
      buyUrl: input.buyUrl,
      imageUrl: input.imageUrl ?? null,
      priceNote: input.priceNote ?? null,
      promoCode: input.promoCode ?? null,
      problem: input.problem ?? null,
      usage: input.usage ?? null,
      enabled: input.enabled ?? true,
      linkStatus: null,
      linkCheckedAt: null,
      linkHttpStatus: null,
      linkNote: null,
      createdAt: now,
      updatedAt: now,
    };
    s.products.push(product);
    return product;
  }
  await ensureSchema();
  const db = sql();
  const rows = await db`
    INSERT INTO products (name, brand, category, blurb, audience, keywords, buy_url, image_url, price_note, promo_code, problem, usage, enabled)
    VALUES (
      ${input.name}::text, ${input.brand ?? null}::text, ${input.category ?? null}::text,
      ${input.blurb ?? ""}::text, ${input.audience ?? null}::text, ${input.keywords ?? ""}::text,
      ${input.buyUrl}::text, ${input.imageUrl ?? null}::text, ${input.priceNote ?? null}::text,
      ${input.promoCode ?? null}::text, ${input.problem ?? null}::text, ${input.usage ?? null}::text,
      ${input.enabled ?? true}::boolean
    )
    RETURNING *
  `;
  return toProduct(rows[0] as Record<string, unknown>);
}

export async function updateProduct(id: number, input: Partial<ProductInput>): Promise<Product | null> {
  if (isDemoMode()) {
    const existing = store().products.find((p) => p.id === id);
    if (!existing) return null;
    Object.assign(existing, {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.brand !== undefined ? { brand: input.brand } : {}),
      ...(input.category !== undefined ? { category: input.category } : {}),
      ...(input.blurb !== undefined ? { blurb: input.blurb } : {}),
      ...(input.audience !== undefined ? { audience: input.audience } : {}),
      ...(input.keywords !== undefined ? { keywords: input.keywords } : {}),
      ...(input.buyUrl !== undefined ? { buyUrl: input.buyUrl } : {}),
      ...(input.imageUrl !== undefined ? { imageUrl: input.imageUrl } : {}),
      ...(input.priceNote !== undefined ? { priceNote: input.priceNote } : {}),
      ...(input.promoCode !== undefined ? { promoCode: input.promoCode } : {}),
      ...(input.problem !== undefined ? { problem: input.problem } : {}),
      ...(input.usage !== undefined ? { usage: input.usage } : {}),
      ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
      updatedAt: new Date().toISOString(),
    });
    return existing;
  }
  await ensureSchema();
  const db = sql();
  // COALESCE against an explicit null-typed parameter rather than building
  // a dynamic SET list: keeps every value a plainly-cast bound parameter
  // (see the fetch_types note above) instead of interpolated SQL.
  const rows = await db`
    UPDATE products SET
      name       = COALESCE(${input.name ?? null}::text, name),
      brand      = COALESCE(${input.brand ?? null}::text, brand),
      category   = COALESCE(${input.category ?? null}::text, category),
      blurb      = COALESCE(${input.blurb ?? null}::text, blurb),
      audience   = COALESCE(${input.audience ?? null}::text, audience),
      keywords   = COALESCE(${input.keywords ?? null}::text, keywords),
      buy_url    = COALESCE(${input.buyUrl ?? null}::text, buy_url),
      image_url  = COALESCE(${input.imageUrl ?? null}::text, image_url),
      price_note = COALESCE(${input.priceNote ?? null}::text, price_note),
      promo_code = COALESCE(${input.promoCode ?? null}::text, promo_code),
      problem    = COALESCE(${input.problem ?? null}::text, problem),
      usage      = COALESCE(${input.usage ?? null}::text, usage),
      enabled    = COALESCE(${input.enabled ?? null}::boolean, enabled),
      updated_at = now()
    WHERE id = ${id}::integer
    RETURNING *
  `;
  return rows.length ? toProduct(rows[0] as Record<string, unknown>) : null;
}

export async function deleteProduct(id: number): Promise<void> {
  if (isDemoMode()) {
    const s = store();
    s.products = s.products.filter((p) => p.id !== id);
    s.clicks = s.clicks.filter((c) => c.productId !== id);
    return;
  }
  await ensureSchema();
  await sql()`DELETE FROM products WHERE id = ${id}::integer`;
}

/**
 * Bulk import from a pasted affiliate/Amazon/LTK list. Every row lands
 * disabled with an empty blurb — an imported link is a stub, not yet
 * something the creator has said anything about, and only enabled
 * products are ever matched or recommended. That's what stops an
 * unfinished import from producing a recommendation with no words behind it.
 */
export async function bulkCreateProducts(rows: { name: string; buyUrl: string; category?: string | null }[]): Promise<number> {
  let created = 0;
  for (const row of rows) {
    await createProduct({ ...row, enabled: false, blurb: "" });
    created += 1;
  }
  return created;
}

// ── Questions and clicks ─────────────────────────────────────────────────

export async function logQuestion(input: {
  question: string;
  productId: number | null;
  matchQuality: MatchQuality;
}): Promise<number> {
  if (isDemoMode()) {
    const s = store();
    const q: ProductQuestion = {
      id: s.nextQuestionId++,
      question: input.question,
      productId: input.productId,
      matchQuality: input.matchQuality,
      createdAt: new Date().toISOString(),
    };
    s.questions.push(q);
    return q.id;
  }
  await ensureSchema();
  const db = sql();
  const rows = await db`
    INSERT INTO product_questions (question, product_id, match_quality)
    VALUES (${input.question}::text, ${input.productId}::integer, ${input.matchQuality}::text)
    RETURNING id
  `;
  return Number(rows[0].id);
}

export async function logClick(input: { productId: number; questionId: number | null }): Promise<void> {
  if (isDemoMode()) {
    store().clicks.push({ ...input, createdAt: new Date().toISOString() });
    return;
  }
  await ensureSchema();
  await sql()`
    INSERT INTO product_clicks (product_id, question_id)
    VALUES (${input.productId}::integer, ${input.questionId}::integer)
  `;
}

/** Records one link-check verdict from src/linkcheck.ts. Silently no-ops on an id that no longer exists — the product can be deleted mid-run. */
export async function recordLinkCheck(
  id: number,
  result: { status: LinkStatus; httpStatus: number | null; note: string },
): Promise<void> {
  const now = new Date().toISOString();
  if (isDemoMode()) {
    const existing = store().products.find((p) => p.id === id);
    if (!existing) return;
    existing.linkStatus = result.status;
    existing.linkCheckedAt = now;
    existing.linkHttpStatus = result.httpStatus;
    existing.linkNote = result.note;
    return;
  }
  await ensureSchema();
  await sql()`
    UPDATE products SET
      link_status      = ${result.status}::text,
      link_checked_at  = now(),
      link_http_status = ${result.httpStatus}::integer,
      link_note        = ${result.note}::text
    WHERE id = ${id}::integer
  `;
}

// ── Aggregates for /admin ────────────────────────────────────────────────

export interface QuestionCount { question: string; count: number }
export interface ProductStat { id: number; name: string; questions: number; clicks: number }
export interface Insights {
  totalQuestions: number;
  totalClicks: number;
  answeredQuestions: number;
  /**
   * Distinct questions that led to at least one click — NOT the raw click
   * count. "How many of those questions ended in a click" has to be a
   * per-question figure: raw clicks counts someone tapping the same
   * recommendation twice, and counts demo-page clicks that carry no
   * question at all, both of which can push a naive clicks/questions rate
   * over 100%.
   */
  questionsWithClick: number;
  topQuestions: QuestionCount[];
  gaps: QuestionCount[];
  products: ProductStat[];
}

export async function getInsights(limit = 10): Promise<Insights> {
  if (isDemoMode()) {
    const s = store();
    const tally = (qs: ProductQuestion[]): QuestionCount[] => {
      const counts = new Map<string, number>();
      for (const q of qs) {
        const key = q.question.trim().toLowerCase();
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
      return [...counts.entries()]
        .map(([question, count]) => ({ question, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, limit);
    };
    return {
      totalQuestions: s.questions.length,
      totalClicks: s.clicks.length,
      answeredQuestions: s.questions.filter((q) => q.matchQuality !== "none").length,
      questionsWithClick: new Set(
        s.clicks.map((c) => c.questionId).filter((id): id is number => id !== null),
      ).size,
      topQuestions: tally(s.questions),
      gaps: tally(s.questions.filter((q) => q.matchQuality !== "strong")),
      products: s.products.map((p) => ({
        id: p.id,
        name: p.name,
        questions: s.questions.filter((q) => q.productId === p.id).length,
        clicks: s.clicks.filter((c) => c.productId === p.id).length,
      })).sort((a, b) => b.clicks - a.clicks || b.questions - a.questions),
    };
  }

  await ensureSchema();
  const db = sql();
  const [totals] = await db`
    SELECT
      count(*)::int AS total,
      count(*) FILTER (WHERE match_quality <> 'none')::int AS answered
    FROM product_questions
  `;
  const [clicks] = await db`
    SELECT
      count(*)::int AS total,
      count(DISTINCT question_id)::int AS with_question
    FROM product_clicks
  `;
  const topQuestions = await db`
    SELECT lower(btrim(question)) AS question, count(*)::int AS count
    FROM product_questions
    GROUP BY 1 ORDER BY count DESC, question ASC LIMIT ${limit}::integer
  `;
  const gaps = await db`
    SELECT lower(btrim(question)) AS question, count(*)::int AS count
    FROM product_questions
    WHERE match_quality <> 'strong'
    GROUP BY 1 ORDER BY count DESC, question ASC LIMIT ${limit}::integer
  `;
  const products = await db`
    SELECT p.id, p.name,
      (SELECT count(*)::int FROM product_questions q WHERE q.product_id = p.id) AS questions,
      (SELECT count(*)::int FROM product_clicks c WHERE c.product_id = p.id) AS clicks
    FROM products p
    ORDER BY clicks DESC, questions DESC, p.name ASC
  `;
  return {
    totalQuestions: Number(totals.total),
    totalClicks: Number(clicks.total),
    answeredQuestions: Number(totals.answered),
    questionsWithClick: Number(clicks.with_question),
    topQuestions: topQuestions.map((r) => ({ question: String(r.question), count: Number(r.count) })),
    gaps: gaps.map((r) => ({ question: String(r.question), count: Number(r.count) })),
    products: products.map((r) => ({
      id: Number(r.id), name: String(r.name),
      questions: Number(r.questions), clicks: Number(r.clicks),
    })),
  };
}

/** Fallback ordering when nothing matched — the catalog's proven picks. */
export async function mostClickedProducts(limit: number): Promise<Product[]> {
  if (isDemoMode()) {
    const s = store();
    const clickCount = (id: number) => s.clicks.filter((c) => c.productId === id).length;
    return s.products.filter((p) => p.enabled)
      .sort((a, b) => clickCount(b.id) - clickCount(a.id))
      .slice(0, limit);
  }
  await ensureSchema();
  const db = sql();
  const rows = await db`
    SELECT p.* FROM products p
    LEFT JOIN product_clicks c ON c.product_id = p.id
    WHERE p.enabled = true
    GROUP BY p.id
    ORDER BY count(c.id) DESC, p.name ASC
    LIMIT ${limit}::integer
  `;
  return rows.map((r) => toProduct(r as Record<string, unknown>));
}
