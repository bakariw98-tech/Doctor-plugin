// src/demo.ts
// Standalone browser demo — no MCP host required. Talks to /api/search
// directly so you can try search + both layouts in a plain browser tab
// (this is what's deployed at the site root on Vercel). The view selector
// exercises the exact same resolveView logic the MCP tool uses, so you
// can compare "auto" against forcing either layout without a chat client.
import { renderVideos, type VideoResult, type ViewMode } from "./carousel";
import { VIEW_OPTIONS, type ViewOption } from "./view";

interface SearchResponse {
  query: string;
  view: ViewMode;
  videos: VideoResult[];
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

let currentVideos: VideoResult[] = [];
let currentView: ViewMode = "carousel";

function render() {
  renderVideos(root, currentVideos, currentView, (url) => {
    window.open(url, "_blank", "noopener,noreferrer");
  });
  // Grid is the fullscreen layout in the real widget — there's no host to
  // actually go fullscreen here, so just give it room to breathe as a
  // visual stand-in.
  page.classList.toggle("wide", currentView === "grid");
}

async function runSearch(query: string, view: ViewOption) {
  searchButton.disabled = true;
  statusEl.textContent = "Searching…";
  try {
    const res = await fetch(`/api/search?q=${encodeURIComponent(query)}&view=${view}`);
    const data = (await res.json()) as SearchResponse;
    if (!res.ok) {
      statusEl.textContent = data.error ?? "Search failed.";
      return;
    }
    currentVideos = data.videos ?? [];
    currentView = data.view ?? "carousel";
    statusEl.textContent = currentVideos.length
      ? `${currentVideos.length} video${currentVideos.length === 1 ? "" : "s"} for "${data.query}" — ${currentView} view`
      : `No videos found for "${data.query}".`;
    render();
  } catch {
    statusEl.textContent = "Search failed. Please try again.";
  } finally {
    searchButton.disabled = false;
  }
}

searchForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const query = searchInput.value.trim();
  if (!query) return;
  void runSearch(query, viewSelect.value as ViewOption);
});

// Re-run the last search with the new view, so switching the dropdown
// alone is enough to compare layouts without retyping the query.
viewSelect.addEventListener("change", () => {
  const query = searchInput.value.trim();
  if (!query || currentVideos.length === 0) return;
  void runSearch(query, viewSelect.value as ViewOption);
});

render();
