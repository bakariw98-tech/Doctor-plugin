// src/carousel.ts
// Shared rendering logic for video results. Used by both the MCP App
// widget (src/mcp-app.ts, driven by the host bridge) and the standalone
// browser demo (src/demo.ts, driven by a plain REST call), so both stay
// visually and behaviorally identical.
//
// No inline player: tapping a video always opens it externally via
// onOpenExternal (app.openLink in the widget, window.open in the demo).
// There's no embed to fight host CSP over, and no two-step play/close —
// one tap, one action.

import type { ViewMode } from "./view";
export type { ViewMode } from "./view";

export interface VideoResult {
  videoId: string;
  title: string;
  description: string;
  thumbnail: string;
  publishedAt: string;
  url: string;
  duration?: string;
  channelTitle: string;
}

export function formatDate(iso: string): string {
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

export function escapeHtml(input: string): string {
  const div = document.createElement("div");
  div.textContent = input;
  return div.innerHTML;
}

function truncate(text: string, max: number): string {
  const trimmed = text.trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max).trimEnd()}…`;
}

/**
 * Renders `videos` into `root` in the given view. `onOpenExternal(url)`
 * fires whenever a thumbnail or "Watch" button is clicked — the caller
 * decides how "open externally" works for its host (app.openLink for the
 * widget, window.open for the plain-browser demo).
 */
export function renderVideos(
  root: HTMLElement,
  videos: VideoResult[],
  view: ViewMode,
  onOpenExternal: (url: string) => void,
) {
  root.innerHTML = "";

  if (videos.length === 0) {
    root.innerHTML = `<p class="empty">No videos yet. Try a search above.</p>`;
    return;
  }

  if (view === "spotlight") {
    renderSpotlight(root, videos, onOpenExternal);
  } else {
    renderCarousel(root, videos, onOpenExternal);
  }
}

// Horizontal scroller — good for a broader set of matches to skim.
function renderCarousel(
  root: HTMLElement,
  videos: VideoResult[],
  onOpenExternal: (url: string) => void,
) {
  const track = document.createElement("div");
  track.className = "carousel-track";

  for (const video of videos) {
    const card = document.createElement("article");
    card.className = "card";
    card.innerHTML = `
      <button class="thumb-btn" type="button" aria-label="Watch ${escapeHtml(video.title)}">
        <img src="${video.thumbnail}" alt="" loading="lazy" />
        ${video.duration ? `<span class="duration">${escapeHtml(video.duration)}</span>` : ""}
        <span class="play-icon">▶</span>
      </button>
      <h3 class="title">${escapeHtml(video.title)}</h3>
      <p class="meta">${escapeHtml(video.channelTitle)} · ${formatDate(video.publishedAt)}</p>
    `;
    card.querySelector(".thumb-btn")!.addEventListener("click", () => onOpenExternal(video.url));
    track.appendChild(card);
  }

  root.appendChild(track);
}

// Stacked, larger cards with a description snippet — good for a small
// number of best matches where each one deserves more room.
function renderSpotlight(
  root: HTMLElement,
  videos: VideoResult[],
  onOpenExternal: (url: string) => void,
) {
  const list = document.createElement("div");
  list.className = "spotlight-list";

  for (const video of videos) {
    const item = document.createElement("article");
    item.className = "spotlight-card";
    item.innerHTML = `
      <button class="spotlight-thumb" type="button" aria-label="Watch ${escapeHtml(video.title)}">
        <img src="${video.thumbnail}" alt="" loading="lazy" />
        ${video.duration ? `<span class="duration">${escapeHtml(video.duration)}</span>` : ""}
        <span class="play-icon">▶</span>
      </button>
      <div class="spotlight-body">
        <h3 class="spotlight-title">${escapeHtml(video.title)}</h3>
        <p class="spotlight-meta">${escapeHtml(video.channelTitle)} · ${formatDate(video.publishedAt)}</p>
        ${video.description ? `<p class="spotlight-desc">${escapeHtml(truncate(video.description, 140))}</p>` : ""}
        <button class="watch-btn" type="button">Watch on YouTube ↗</button>
      </div>
    `;
    item
      .querySelector(".spotlight-thumb")!
      .addEventListener("click", () => onOpenExternal(video.url));
    item.querySelector(".watch-btn")!.addEventListener("click", () => onOpenExternal(video.url));
    list.appendChild(item);
  }

  root.appendChild(list);
}
