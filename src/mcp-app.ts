// src/mcp-app.ts
// UI logic for the video carousel widget. Runs inside the sandboxed iframe
// the MCP host renders, and talks back to the server via the App bridge.
import { App } from "@modelcontextprotocol/ext-apps";

interface VideoResult {
  videoId: string;
  title: string;
  description: string;
  thumbnail: string;
  publishedAt: string;
  url: string;
  duration?: string;
  channelTitle: string;
}

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

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return "";
  }
}

function escapeHtml(input: string): string {
  const div = document.createElement("div");
  div.textContent = input;
  return div.innerHTML;
}

function render() {
  root.innerHTML = "";

  if (currentVideos.length === 0) {
    root.innerHTML = `<p class="empty">No videos yet. Try a search above.</p>`;
    return;
  }

  const track = document.createElement("div");
  track.className = "carousel-track";

  for (const video of currentVideos) {
    const card = document.createElement("article");
    card.className = "card";

    if (playingId === video.videoId) {
      card.classList.add("playing");
      card.innerHTML = `
        <div class="player-wrap">
          <iframe
            src="https://www.youtube.com/embed/${video.videoId}?autoplay=1&rel=0"
            title="${escapeHtml(video.title)}"
            allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
            allowfullscreen
          ></iframe>
        </div>
        <h3 class="title">${escapeHtml(video.title)}</h3>
        <button class="close-btn" type="button">Close</button>
      `;
      card.querySelector(".close-btn")!.addEventListener("click", () => {
        playingId = null;
        render();
      });
    } else {
      card.innerHTML = `
        <button class="thumb-btn" type="button" aria-label="Play ${escapeHtml(video.title)}">
          <img src="${video.thumbnail}" alt="" loading="lazy" />
          ${video.duration ? `<span class="duration">${escapeHtml(video.duration)}</span>` : ""}
          <span class="play-icon">▶</span>
        </button>
        <h3 class="title">${escapeHtml(video.title)}</h3>
        <p class="meta">${escapeHtml(video.channelTitle)} · ${formatDate(video.publishedAt)}</p>
      `;
      card.querySelector(".thumb-btn")!.addEventListener("click", () => {
        playingId = video.videoId;
        render();
      });
    }

    track.appendChild(card);
  }

  root.appendChild(track);
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
