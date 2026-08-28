// src/mcp-app.ts
// UI logic for the video results widget. Runs inside the sandboxed iframe
// the MCP host renders, and talks back to the server via the App bridge.
import { App } from "@modelcontextprotocol/ext-apps";
import { renderVideos, type VideoResult, type ViewMode } from "./carousel";
import { resolveView } from "./view";

interface ToolPayload {
  query: string;
  view: ViewMode;
  videos: VideoResult[];
}

const root = document.getElementById("root")!;
const searchForm = document.getElementById("search-form") as HTMLFormElement;
const searchInput = document.getElementById("search-input") as HTMLInputElement;
const searchButton = document.getElementById("search-button") as HTMLButtonElement;
const statusEl = document.getElementById("status")!;
const fullscreenBar = document.getElementById("fullscreen-bar")!;
const fullscreenToggle = document.getElementById("fullscreen-toggle") as HTMLButtonElement;

const app = new App({ name: "Doctor Video Search", version: "1.0.0" });
app.connect();

let currentVideos: VideoResult[] = [];
let currentView: ViewMode = "carousel";
// Only true once we've actually switched to the fullscreen-only "grid"
// layout via requestDisplayMode — lets us tell "grid because we asked for
// fullscreen" apart from "grid because the tool/demo forced it directly".
let inFullscreen = false;

// Fullscreen is a request, not a guarantee — only offer it when the host
// says it's actually available, and only when there's enough to browse to
// make it worthwhile (a handful of results already fit the carousel fine).
const FULLSCREEN_THRESHOLD = 8;

function supportsFullscreen(): boolean {
  return Boolean(app.getHostContext()?.availableDisplayModes?.includes("fullscreen"));
}

function updateFullscreenBar() {
  if (inFullscreen) {
    fullscreenBar.hidden = false;
    fullscreenToggle.textContent = "Done";
  } else if (currentView === "carousel" && currentVideos.length > FULLSCREEN_THRESHOLD && supportsFullscreen()) {
    fullscreenBar.hidden = false;
    fullscreenToggle.textContent = `View all ${currentVideos.length} ⤢`;
  } else {
    fullscreenBar.hidden = true;
  }
}

function render() {
  renderVideos(root, currentVideos, currentView, (url) => {
    void app.openLink({ url });
  });
  updateFullscreenBar();
}

function applyPayload(payload: ToolPayload | undefined | null) {
  if (!payload) return;
  currentVideos = payload.videos ?? [];
  currentView = payload.view ?? "carousel";
  inFullscreen = false;
  statusEl.textContent = currentVideos.length
    ? `${currentVideos.length} video${currentVideos.length === 1 ? "" : "s"} for "${payload.query}"`
    : `No videos found for "${payload.query}".`;
  render();
}

fullscreenToggle.addEventListener("click", async () => {
  if (inFullscreen) {
    const result = await app.requestDisplayMode({ mode: "inline" });
    if (result.mode !== "fullscreen") {
      inFullscreen = false;
      currentView = resolveView(undefined, currentVideos.length);
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
    currentView = resolveView(undefined, currentVideos.length);
    render();
  }
});

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
