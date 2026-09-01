// src/mcp-app.ts
// UI logic for the recommendations widget. Runs inside the sandboxed
// iframe the MCP host renders, and talks back to the server via the App
// bridge.
//
// No search box here: the chat is the search box. The person already
// asked; a second field in the widget would just make them retype it.
// Asking about something else happens by talking to the agent again.
//
// Nothing is collected from the person here — no form, no email, no
// callback into the server. The only outbound action is opening the buy
// link, which is why this file needs no serverTools capability at all.
import { App } from "@modelcontextprotocol/ext-apps";
import { renderProducts, type ProductPick } from "./product-card";
import { resolveView, type ViewMode } from "./view";

interface ProductPayload {
  kind?: "products";
  question: string;
  view: ViewMode;
  matchQuality?: "strong" | "weak" | "none";
  products: ProductPick[];
}

const root = document.getElementById("root")!;
const statusEl = document.getElementById("status")!;
const fullscreenBar = document.getElementById("fullscreen-bar")!;
const fullscreenToggle = document.getElementById("fullscreen-toggle") as HTMLButtonElement;

const app = new App({ name: "Creator Picks", version: "1.0.0" });
void app.connect();

let currentProducts: ProductPick[] = [];
let currentView: ViewMode = "carousel";
// Only true once we've actually switched to the fullscreen-only "grid"
// layout via requestDisplayMode — lets us tell "grid because we asked for
// fullscreen" apart from "grid because the tool forced it directly".
let inFullscreen = false;

// Fullscreen is a request, not a guarantee — only offer it when the host
// says it's actually available, and only when there's enough to browse to
// make it worthwhile (a handful already fit the carousel fine).
const FULLSCREEN_THRESHOLD = 8;

function supportsFullscreen(): boolean {
  return Boolean(app.getHostContext()?.availableDisplayModes?.includes("fullscreen"));
}

function updateFullscreenBar() {
  if (inFullscreen) {
    fullscreenBar.hidden = false;
    fullscreenToggle.textContent = "Done";
  } else if (currentView === "carousel" && currentProducts.length > FULLSCREEN_THRESHOLD && supportsFullscreen()) {
    fullscreenBar.hidden = false;
    fullscreenToggle.textContent = `View all ${currentProducts.length} ⤢`;
  } else {
    fullscreenBar.hidden = true;
  }
}

function render() {
  updateFullscreenBar();
  renderProducts(root, currentProducts, currentView, (url) => {
    void app.openLink({ url });
  });
}

function applyPayload(payload: ProductPayload | undefined) {
  if (!payload) return;
  currentProducts = payload.products ?? [];
  currentView = payload.view ?? "carousel";
  // Visually silent — the agent's own reply carries the words. This is
  // only for screen readers, which have no other way to know the result
  // loaded (there's no visible status line to announce it for them).
  statusEl.textContent = currentProducts.length
    ? `${currentProducts.length} recommendation${currentProducts.length === 1 ? "" : "s"} loaded.`
    : "No recommendations.";
  render();
}

fullscreenToggle.addEventListener("click", async () => {
  if (inFullscreen) {
    const result = await app.requestDisplayMode({ mode: "inline" });
    if (result.mode !== "fullscreen") {
      inFullscreen = false;
      currentView = resolveView(undefined, currentProducts.length);
      render();
    }
    return;
  }

  const result = await app.requestDisplayMode({ mode: "fullscreen" });
  if (result.mode === "fullscreen") {
    inFullscreen = true;
    currentView = "grid";
    render();
  }
});

// The host can also change display mode on its own (e.g. the user exits
// fullscreen via host chrome) — stay in sync rather than trusting only our
// own toggle's result.
app.addEventListener("hostcontextchanged", () => {
  const mode = app.getHostContext()?.displayMode;
  if (inFullscreen && mode !== "fullscreen") {
    inFullscreen = false;
    currentView = resolveView(undefined, currentProducts.length);
    render();
  }
});

// Fires when the host pushes the initial (or a fresh) tool result.
app.ontoolresult = (result) => {
  applyPayload(result.structuredContent as ProductPayload | undefined);
};

render();
