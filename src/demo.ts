// src/demo.ts
// Standalone browser demo — no MCP host required. Talks to /api/search
// directly so you can try the search + carousel + inline playback in a
// plain browser tab (this is what's deployed at the site root on Vercel).
import { renderCarousel, type VideoResult } from "./carousel";

interface SearchResponse {
  query: string;
  videos: VideoResult[];
  error?: string;
}

const root = document.getElementById("root")!;
const searchForm = document.getElementById("search-form") as HTMLFormElement;
const searchInput = document.getElementById("search-input") as HTMLInputElement;
const searchButton = document.getElementById("search-button") as HTMLButtonElement;
const statusEl = document.getElementById("status")!;

let currentVideos: VideoResult[] = [];
let playingId: string | null = null;

function render() {
  renderCarousel(
    root,
    currentVideos,
    playingId,
    (videoId) => {
      playingId = videoId;
      render();
    },
    () => {
      playingId = null;
      render();
    },
    (url) => {
      window.open(url, "_blank", "noopener,noreferrer");
    },
  );
}

async function runSearch(query: string) {
  searchButton.disabled = true;
  statusEl.textContent = "Searching…";
  try {
    const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
    const data = (await res.json()) as SearchResponse;
    if (!res.ok) {
      statusEl.textContent = data.error ?? "Search failed.";
      return;
    }
    currentVideos = data.videos ?? [];
    playingId = null;
    statusEl.textContent = currentVideos.length
      ? `${currentVideos.length} video${currentVideos.length === 1 ? "" : "s"} for "${data.query}"`
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
  void runSearch(query);
});

render();
