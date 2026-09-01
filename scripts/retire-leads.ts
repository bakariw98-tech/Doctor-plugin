// scripts/retire-leads.ts
// One-time cleanup for deployments upgrading from the lead-capture
// version of this app (offer_lead_magnet / submit_lead / the /admin leads
// dashboard), all of which have been removed.
//
// Run it twice, on purpose:
//   npm run retire-leads           # export only — writes leads-export.csv
//   npm run retire-leads -- --drop # then actually drop the three tables
//
// Dropping is never automatic and never part of ensureSchema: a deploy
// that silently destroyed someone's collected email list would be
// unrecoverable, so it takes a deliberate second command after the export
// exists and has been checked.
import { readFileSync, writeFileSync } from "node:fs";
import postgres from "postgres";

const OUT = "leads-export.csv";

function csvField(value: string): string {
  if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

async function main() {
  const url = process.env.DATABASE_URL?.trim();
  if (!url) throw new Error("Set DATABASE_URL (see .env.example).");
  const sql = postgres(url, { max: 1, prepare: false, fetch_types: false });

  const exists = await sql`SELECT to_regclass('public.leads') AS t`;
  if (!exists[0].t) {
    console.log("No `leads` table — nothing to retire.");
    await sql.end();
    return;
  }

  const leads = await sql`SELECT id, email, name, topic, answers, created_at FROM leads ORDER BY created_at DESC`;
  const answerKeys = [...new Set(leads.flatMap((l) => Object.keys(l.answers ?? {})))];
  const header = ["id", "email", "name", "topic", "created_at", ...answerKeys];
  const rows = leads.map((l) => [
    String(l.id), String(l.email ?? ""), String(l.name ?? ""), String(l.topic ?? ""),
    new Date(l.created_at).toISOString(),
    ...answerKeys.map((k) => String((l.answers ?? {})[k] ?? "")),
  ].map(csvField).join(","));
  writeFileSync(OUT, [header.map(csvField).join(","), ...rows].join("\n") + "\n");
  console.log(`Exported ${leads.length} lead(s) to ${OUT}.`);

  if (!process.argv.includes("--drop")) {
    console.log("Export only. Check the file, then re-run with --drop to remove the tables.");
    await sql.end();
    return;
  }

  // Guard against dropping on the strength of an export that isn't there.
  const written = readFileSync(OUT, "utf8").trim().split("\n").length - 1;
  if (written !== leads.length) {
    throw new Error(`Refusing to drop: ${OUT} has ${written} rows but the table has ${leads.length}.`);
  }

  await sql`DROP TABLE IF EXISTS leads`;
  await sql`DROP TABLE IF EXISTS lead_form_questions`;
  await sql`DROP TABLE IF EXISTS lead_magnet_config`;
  console.log("Dropped leads, lead_form_questions, lead_magnet_config.");
  await sql.end();
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
