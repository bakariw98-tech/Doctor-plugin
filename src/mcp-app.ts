// src/mcp-app.ts
// UI logic for the video carousel widget. Runs inside the sandboxed iframe
// the MCP host renders, and talks back to the server via the App bridge.
import { App } from "@modelcontextprotocol/ext-apps";
import { renderCarousel, type VideoResult } from "./carousel";

interface ToolPayload {
  query: string;
  videos: VideoResult[];
}

const root = document.getElementById("root")!;
const searchForm = document.getElementById("search-form") as HTMLFormElement;
const searchInput = document.getElementById("search-input") as HTMLInputElement;
const searchButton = document.getElementById("search-button") as HTMLButtonElement;
const statusEl = document.getElementById("status")!;

const app = new App({ name: "Doctor Video Search", version: "1.0.0" });
app.connect();

let currentVideos: VideoResult[] = [];
// videoId of the card currently showing an embedded player, if any.
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
  );
}

function applyPayload(payload: ToolPayload | undefined | null) {
  if (!payload) return;
  currentVideos = payload.videos ?? [];
  playingId = null;
  statusEl.textContent = currentVideos.length
    ? `${currentVideos.length} video${currentVideos.length === 1 ? "" : "s"} for "${payload.query}"`
    : `No videos found for "${payload.query}".`;
  render();
}

// Fires when the host pushes the initial (or a fresh) tool result.
app.ontoolresult = (result) => {
  applyPayload(result.structuredContent as ToolPayload | undefined);
};

// Lets people refine the search from inside the widget itself, without
// going back to the chat, by calling the same server tool again.
searchForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const query = searchInput.value.trim();
  if (!query) return;

  searchButton.disabled = true;
  statusEl.textContent = "Searching…";
  try {
    const result = await app.callServerTool({
      name: "search_doctor_videos",
      arguments: { query },
    });
    applyPayload(result.structuredContent as ToolPayload | undefined);
  } catch {
    statusEl.textContent = "Search failed. Please try again.";
  } finally {
    searchButton.disabled = false;
  }
});

render();
