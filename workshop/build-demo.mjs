#!/usr/bin/env node
// workshop/build-demo.mjs
// Turns a prospect record into a demo fixture the widget can render.
//
// This is workshop tooling. It never ships inside a deployment (doctrine
// §12) — it exists so that going from "I found someone worth pitching" to
// "here is their own catalog answering their own audience's question, in
// the real product" is a command rather than an afternoon.
//
// Two modes, because prospects arrive in two states:
//
//   --from-live <origin>   They already have a deployment (or you built one
//                          on spec). Captures a REAL /api/recommend response,
//                          so the demo cannot drift from what actually ships.
//
//   (default)              They don't. Builds the fixture from the
//                          `recommendations` array in their prospect file.
//                          Products missing a photo or blurb are reported —
//                          those are what make a demo look real, and a demo
//                          with grey boxes where the products should be is
//                          worse than no demo.
//
// Output lands in workshop/demos/<slug>/ and is directly loadable by the
// demo page's fixture mode — see fixtures/README.md for how to drive it
// from a URL or from Remotion.
import fs from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const slug = args[0];
if (!slug || slug.startsWith("--")) {
  console.error(`Usage:
  node workshop/build-demo.mjs <slug> --question "what salt do you use" [--view card|spotlight|list]
  node workshop/build-demo.mjs <slug> --from-live https://their-deployment.vercel.app --question "..."

Prospects live in workshop/prospects/<slug>.json (copy _template.json to start one).`);
  process.exit(1);
}

const flag = (name, fallback = null) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? fallback : args[i + 1];
};

const root = path.resolve(import.meta.dirname, "..");
const prospectPath = path.join(root, "workshop/prospects", `${slug}.json`);
if (!fs.existsSync(prospectPath)) {
  console.error(`No prospect file at workshop/prospects/${slug}.json`);
  process.exit(1);
}
const prospect = JSON.parse(fs.readFileSync(prospectPath, "utf8"));

const question = flag("question");
if (!question) {
  console.error("--question is required: it's the audience question the demo answers.");
  process.exit(1);
}
const live = flag("from-live");
const view = flag("view", "card");

const outDir = path.join(root, "workshop/demos", slug);
fs.mkdirSync(outDir, { recursive: true });
const outName = `${question.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48)}.json`;
const outPath = path.join(outDir, outName);

if (live) {
  const url = `${live.replace(/\/+$/, "")}/api/recommend?q=${encodeURIComponent(question)}&view=${view}`;
  const res = await fetch(url);
  if (!res.ok) {
    console.error(`Live capture failed: ${res.status} ${res.statusText}`);
    process.exit(1);
  }
  const payload = await res.json();
  fs.writeFileSync(outPath, JSON.stringify(payload, null, 2) + "\n");
  console.log(`Captured ${payload.products?.length ?? 0} product(s), match "${payload.matchQuality}" -> ${path.relative(root, outPath)}`);
  if (payload.matchQuality !== "strong") {
    console.log(`  ! Match is "${payload.matchQuality}", not "strong". Film a question the catalog answers confidently.`);
  }
} else {
  // No deployment yet: assemble the payload by hand from the prospect file.
  const picks = (prospect.recommendations ?? []).filter((r) => r.demo === true);
  if (picks.length === 0) {
    console.error(`Nothing to build. Mark the products to feature with "demo": true in workshop/prospects/${slug}.json,
or use --from-live if they already have a deployment.`);
    process.exit(1);
  }
  const products = picks.slice(0, 3).map((r, i) => ({
    id: i + 1,
    name: r.name,
    imageUrl: r.imageUrl ?? null,
    priceNote: r.priceNote ?? null,
    promoCode: r.promoCode ?? null,
    blurb: r.blurb ?? "",
    usage: r.usage ?? null,
    buyUrl: r.buyUrl ?? "#",
  }));
  const payload = { question, view: products.length > 1 ? "spotlight" : view, matchQuality: "strong", products };
  fs.writeFileSync(outPath, JSON.stringify(payload, null, 2) + "\n");
  console.log(`Built ${products.length} product(s) -> ${path.relative(root, outPath)}`);

  const missing = products.filter((p) => !p.imageUrl || !p.blurb);
  for (const p of missing) {
    const gaps = [!p.imageUrl && "photo", !p.blurb && "blurb"].filter(Boolean).join(" + ");
    console.log(`  ! ${p.name} is missing a ${gaps} — fill it before filming.`);
  }
}

console.log(`\nPreview it:  npm run build && npm run serve`);
console.log(`then open:   http://localhost:3001/?fixture=$(node -p "require('fs').readFileSync('${path.relative(root, outPath)}').toString('base64url')")`);
