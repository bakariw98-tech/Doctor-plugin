// src/demo.ts
// Standalone browser demo — no MCP host required. Talks to /api/recommend
// directly so you can try the flow and every layout in a plain browser tab
// (this is what's deployed at the site root on Vercel). The view selector
// exercises the exact same resolveView logic the MCP tool uses, so you can
// compare "auto" against forcing any layout without a chat client.
//
// The same page has a second, offline entrance: `?fixture=<base64url>` (or
// window.setFixture) draws a payload handed straight in, with no catalog,
// no host and no /api/recommend behind it. That's what the outbound demo
// videos are filmed from — a prospect's own products in this widget, before
// anything of theirs exists in any database. It deliberately lands on the
// same render() a live search does: the day the video path grows its own
// copy of the markup is the day the demos start selling a widget that isn't
// the one that ships.
import { renderProducts, type ProductPick } from "./product-card";
import { VIEW_OPTIONS, type ViewOption, type ViewMode } from "./view";

interface RecommendResponse {
  question: string;
  view: ViewMode;
  matchQuality?: "strong" | "weak" | "none";
  products: ProductPick[];
  error?: string;
}

const page = document.getElementById("page")!;
const root = document.getElementById("root")!;
const searchForm = document.getElementById("search-form") as HTMLFormElement;
const searchInput = document.getElementById("search-input") as HTMLInputElement;
const searchButton = document.getElementById("search-button") as HTMLButtonElement;
const statusEl = document.getElementById("status")!;
const viewSelect = document.getElementById("view-select") as HTMLSelectElement;

const VIEW_LABELS: Record<ViewOption, string> = {
  auto: "Auto",
  card: "Card",
  spotlight: "Spotlight",
  list: "List",
  grid: "Grid (fullscreen)",
};

viewSelect.innerHTML = VIEW_OPTIONS.map(
  (option) => `<option value="${option}">${VIEW_LABELS[option]}</option>`,
).join("");

let currentProducts: ProductPick[] = [];
let currentView: ViewMode = "list";

function render() {
  renderProducts(root, currentProducts, currentView, (url) => {
    window.open(url, "_blank", "noopener,noreferrer");
  });
  // Grid is the fullscreen layout in the real widget — there's no host to
  // actually go fullscreen here, so just give it room to breathe as a
  // visual stand-in.
  page.classList.toggle("wide", currentView === "grid");
}

// How the tool phrases a weak/no match for the model. The demo has no
// agent to speak that framing, so it says it in the status line instead —
// otherwise a steer looks identical to a direct answer here, which is the
// one thing this flow must never do.
const QUALITY_NOTE: Record<string, string> = {
  weak: "closest thing they use — not a direct answer",
  none: "no pick for this — showing what they recommend most",
};

async function runSearch(question: string, view: ViewOption) {
  searchButton.disabled = true;
  statusEl.textContent = "Looking…";
  try {
    const res = await fetch(`/api/recommend?q=${encodeURIComponent(question)}&view=${view}`);
    const data = (await res.json()) as RecommendResponse;
    if (!res.ok) {
      statusEl.textContent = data.error ?? "Lookup failed.";
      return;
    }
    currentProducts = data.products ?? [];
    currentView = data.view ?? "list";
    const note = data.matchQuality ? QUALITY_NOTE[data.matchQuality] : undefined;
    statusEl.textContent = currentProducts.length
      ? `${currentProducts.length} for "${data.question}" — ${currentView} view` +
        (note ? ` · ${note}` : "")
      : `Nothing to recommend for "${data.question}".`;
    render();
  } catch {
    statusEl.textContent = "Lookup failed. Please try again.";
  } finally {
    searchButton.disabled = false;
  }
}

searchForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const question = searchInput.value.trim();
  if (!question) return;
  void runSearch(question, viewSelect.value as ViewOption);
});

// Re-run the last question with the new view, so switching the dropdown
// alone is enough to compare layouts without retyping it.
viewSelect.addEventListener("change", () => {
  const question = searchInput.value.trim();
  if (!question || currentProducts.length === 0) return;
  void runSearch(question, viewSelect.value as ViewOption);
});

// --- Fixture mode (see the file header) ------------------------------------

/** A fixture is a /api/recommend response, so a real one can be captured
 *  from a live deployment and replayed here verbatim. `question` and
 *  `matchQuality` only feed the status line, which is hidden in a capture —
 *  they're carried anyway so the two payloads stay one shape. */
type Fixture = Omit<RecommendResponse, "error">;

declare global {
  interface Window {
    /** Resolves when the frame is safe to screenshot. */
    setFixture(fixture: Fixture): Promise<void>;
  }
}

// base64url rather than plain base64 because the payload rides in a query
// string, where + and / already mean something else; padding is re-added
// because most encoders strip it. Decoding through TextDecoder instead of
// reading atob()'s output directly keeps non-ASCII product names (é, —, ™)
// from arriving as mojibake in the card.
function decodeFixture(param: string): Fixture {
  const b64 = param.replace(/-/g, "+").replace(/_/g, "/");
  const bytes = Uint8Array.from(atob(b64.padEnd(Math.ceil(b64.length / 4) * 4, "=")), (ch) =>
    ch.charCodeAt(0),
  );
  return JSON.parse(new TextDecoder().decode(bytes)) as Fixture;
}

function hide(el: HTMLElement) {
  el.hidden = true;
  // #search-form carries its own `display: flex`, which outranks the UA
  // sheet's `[hidden] { display: none }` — the attribute alone leaves it
  // on screen and in the shot.
  el.style.display = "none";
}

let fixtureGeneration = 0;

/**
 * Draw a fixture, then flag the frame as finished on
 * `document.documentElement.dataset.fixtureReady`, which is what the video
 * renderer polls before it captures. Without that flag the shots land on
 * product photos that are still half-decoded.
 */
async function applyFixture(fixture: Fixture): Promise<void> {
  const generation = ++fixtureGeneration;
  const html = document.documentElement;
  delete html.dataset.fixtureReady;

  // Everything this page has that the real widget doesn't: a question box,
  // a layout picker, and a status line standing in for the agent's voice.
  // A capture is of the card alone.
  hide(searchForm); // the view dropdown lives inside it
  hide(statusEl);

  currentProducts = fixture.products ?? [];
  currentView = fixture.view ?? "list";
  render();

  await Promise.all(
    Array.from(root.querySelectorAll("img")).map((img) => {
      // Cards ship loading="lazy"; below the fold that means never fetched
      // at all, and we'd call an empty frame ready.
      img.loading = "eager";
      // decode() settles for an image already in cache too — whose load
      // event fired before this ran and will not fire again — and rejects
      // on a dead URL, which still has to count as settled or one broken
      // link stalls the render forever.
      return img.decode().catch(() => undefined);
    }),
  );

  // A later setFixture() already owns the page by now; reporting ready here
  // would signal over *its* still-loading images.
  if (generation !== fixtureGeneration) return;
  html.dataset.fixtureReady = "1";
}

// Installed whether or not a fixture is in the URL: a payload with inlined
// base64 photos runs to megabytes, well past what a URL can carry, so the
// renderer hands those over through page.evaluate instead. Nothing happens
// until it's called, so the plain demo is untouched.
window.setFixture = applyFixture;

const fixtureParam = new URLSearchParams(window.location.search).get("fixture");
let fixture: Fixture | undefined;
if (fixtureParam) {
  try {
    fixture = decodeFixture(fixtureParam);
  } catch (err) {
    // Reported in the demo's own error channel with the chrome left up: a
    // malformed payload must not read as an empty catalog. fixtureReady
    // stays unset, so the renderer times out rather than filming this.
    statusEl.textContent = `Bad ?fixture= payload: ${err instanceof Error ? err.message : String(err)}`;
  }
}

if (fixture) void applyFixture(fixture);
else render();
