// src/demo.ts
// Standalone browser demo — no MCP host required. Talks to /api/recommend
// directly so you can try the flow and every layout in a plain browser tab
// (this is what's deployed at the site root on Vercel). The view selector
// exercises the exact same resolveView logic the MCP tool uses, so you can
// compare "auto" against forcing any layout without a chat client.
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
  carousel: "Carousel",
  grid: "Grid (fullscreen)",
};

viewSelect.innerHTML = VIEW_OPTIONS.map(
  (option) => `<option value="${option}">${VIEW_LABELS[option]}</option>`,
).join("");

let currentProducts: ProductPick[] = [];
let currentView: ViewMode = "carousel";

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
    currentView = data.view ?? "carousel";
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

render();
