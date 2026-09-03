#!/usr/bin/env node
// workshop/shoot.mjs
// Renders a demo fixture to a PNG through the real widget.
//
// The last mile of the prospecting flow: build-demo.mjs produces a fixture,
// this turns it into something you can actually attach to an email or a DM.
// For cold outreach a still of THEIR product in the card is usually a
// better opener than a video anyway — it loads in the preview pane.
//
// It drives the same fixture mode Remotion uses (fixtures/README.md), so
// what you send is pixel-for-pixel the shipping card, not a mockup of it.
//
// Playwright is an optional tool dependency, not part of the app — install
// it only if you want to shoot stills:  npm i -D playwright
//
// Requires the dev server running:  npm run build && npm run serve
import fs from "node:fs";
import path from "node:path";

let chromium;
try {
  ({ chromium } = await import("playwright"));
} catch {
  console.error("Playwright isn't installed. It's an optional workshop tool:\n  npm i -D playwright");
  process.exit(1);
}

const args = process.argv.slice(2);
const fixtureArg = args[0];
if (!fixtureArg || fixtureArg.startsWith("--")) {
  console.error(`Usage: node workshop/shoot.mjs <fixture.json> [--out shot.png] [--port 3001] [--width 900]

Example:
  node workshop/shoot.mjs workshop/demos/missmeat/what-do-you-use-for-seasoning.json`);
  process.exit(1);
}
const flag = (n, d = null) => { const i = args.indexOf(`--${n}`); return i === -1 ? d : args[i + 1]; };

const root = path.resolve(import.meta.dirname, "..");
const fixturePath = path.resolve(root, fixtureArg);
if (!fs.existsSync(fixturePath)) {
  console.error(`No fixture at ${fixtureArg}`);
  process.exit(1);
}
const payload = JSON.parse(fs.readFileSync(fixturePath, "utf8"));
const port = flag("port", "3001");
const width = Number(flag("width", "900"));
const out = path.resolve(root, flag("out", fixturePath.replace(/\.json$/, ".png")));

// Only route through a proxy if the environment actually uses one, and
// never for localhost — the dev server speaks plain HTTP, which a
// CONNECT-only proxy will refuse.
const proxyServer = process.env.HTTPS_PROXY || process.env.https_proxy;
const browser = await chromium.launch({
  ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
  ...(proxyServer ? { proxy: { server: proxyServer, bypass: "localhost,127.0.0.1" } } : {}),
});
const page = await browser.newPage({ viewport: { width, height: 1200 }, deviceScaleFactor: 2 });

try {
  await page.goto(`http://localhost:${port}/`, { timeout: 15000 });
} catch {
  console.error(`Couldn't reach the dev server on :${port}. Start it with:\n  npm run build && npm run serve`);
  await browser.close();
  process.exit(1);
}

await page.evaluate((p) => window.setFixture(p), payload);
await page.waitForSelector('[data-fixture-ready="1"]', { timeout: 30000 });

// Report any product photo that didn't load — a broken image is the one
// defect you must never discover after sending.
const broken = await page.$$eval("#root img", (els) =>
  els.filter((e) => !e.naturalWidth).map((e) => e.currentSrc || e.src));
for (const src of broken) console.log(`  ! photo failed to load: ${src.slice(0, 90)}`);

await (await page.$("#root")).screenshot({ path: out });
await browser.close();
console.log(`${broken.length ? "Shot WITH BROKEN PHOTOS" : "Shot"} -> ${path.relative(root, out)}`);
