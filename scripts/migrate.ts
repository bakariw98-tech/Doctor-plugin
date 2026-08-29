// scripts/migrate.ts
// Manual convenience script: creates the lead-capture tables and verifies
// the database connection actually works. Not required for correctness —
// src/db.ts's ensureSchema() runs the same idempotent CREATE TABLE IF NOT
// EXISTS statements automatically on first use of any query helper (the
// first tool call, or the first /admin hit) — this just lets you check
// connectivity once, right after provisioning, without going through the
// app.
//
// Run: npm run migrate   (reads DATABASE_URL from .env via Node's
// --env-file, same as npm run fetch-transcripts)
import { ensureSchema, getMagnetConfig } from "../src/db.js";

async function main() {
  console.log("Connecting and creating tables if they don't exist yet...");
  await ensureSchema();
  const config = await getMagnetConfig();
  console.log("Connected. Schema is ready.");
  console.log(`Current lead magnet config: "${config.title}" (enabled: ${config.enabled})`);
  console.log("Next: set ADMIN_TOKEN in .env and Vercel, then visit /admin to configure it for real.");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
