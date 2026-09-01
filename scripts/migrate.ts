// scripts/migrate.ts
// Manual connectivity check: creates the catalog tables if they don't
// exist and reads them back. The app does this automatically on first use
// (ensureSchema in src/db.ts), so this exists only to confirm a new
// DATABASE_URL actually works before wiring anything else up.
//   npm run migrate
import { ensureSchema, listProducts } from "../src/db.js";

async function main() {
  await ensureSchema();
  const products = await listProducts();
  console.log(`Schema OK. ${products.length} product(s) in the catalog.`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
