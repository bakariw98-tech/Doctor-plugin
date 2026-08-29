// src/carousel.ts
// Shared rendering logic for video results. Used by both the MCP App
// widget (src/mcp-app.ts, driven by the host bridge) and the standalone
// browser demo (src/demo.ts, driven by a plain REST call), so both stay
// visually and behaviorally identical.
//
// A single 'card' result is thumbnail-only — no title, date, channel
// name, or description drawn on it. That's the agent's job, spoken above
// the widget in the chat, and there's exactly one thumbnail for the
// agent's words to refer to unambiguously (see design/README.md).
// 'carousel' and 'grid' hold several thumbnails at once, so that
// assumption breaks: the agent's reply can't stay pinned next to a
// specific tile as someone scrolls or swipes past it, and with more than
// one thumbnail on screen there's no way to tell which is which without
// a label. Those two layouts carry the video's title on the card itself
// for that reason; 'card' still doesn't. One tap opens the video
// externally via onOpenExternal (app.openLink in the widget, window.open
// in the demo) — no inline player, no second "watch" affordance.

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
  // Not read by this file — the widget draws thumbnails only. Carried in
  // the type because it flows through the same structuredContent the
  // model reasons over (src/mcp-server.ts).
  tags?: string[];
  transcript?: string;
}

export function escapeHtml(input: string): string {
  const div = document.createElement("div");
  div.textContent = input;
  return div.innerHTML;
}

const PLAY_ICON = `
  <svg width="30" height="30" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <circle cx="12" cy="12" r="11" fill="rgba(255,255,255,0.94)"/>
    <path d="M10 8.6l6 3.4-6 3.4V8.6z" fill="#141414"/>
  </svg>
`;

// The one shared unit: a thumbnail, a duration chip, a hover play cue,
// and — for multi-thumbnail layouts only (see file header) — a title
// caption identifying which video this is.
function renderThumb(
  video: VideoResult,
  onOpenExternal: (url: string) => void,
  showTitle: boolean,
): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "shot";
  btn.setAttribute("aria-label", `Watch ${video.title}`);
  btn.innerHTML = `
    <img src="${video.thumbnail}" alt="" loading="lazy" />
    ${video.duration ? `<span class="dur">${escapeHtml(video.duration)}</span>` : ""}
    <span class="cue">${PLAY_ICON}</span>
    ${showTitle ? `<span class="title">${escapeHtml(video.title)}</span>` : ""}
  `;
  btn.addEventListener("click", () => onOpenExternal(video.url));
  return btn;
}

const CONTAINER_CLASS: Record<ViewMode, string> = {
  card: "view-solo",
  spotlight: "view-split",
  carousel: "view-strip",
  grid: "view-wall",
};

// See the file header: 'carousel' and 'grid' hold several thumbnails at
// once, so each one carries its title; 'card' and 'spotlight' don't.
const SHOWS_TITLE: Record<ViewMode, boolean> = {
  card: false,
  spotlight: false,
  carousel: true,
  grid: true,
};

/**
 * Renders `videos` into `root` in the given view — a container shaped for
 * the result count (solo / split-to-fit / scrolling strip / wrapping
 * wall). `onOpenExternal(url)` fires on tap.
 */
export function renderVideos(
  root: HTMLElement,
  videos: VideoResult[],
  view: ViewMode,
  onOpenExternal: (url: string) => void,
) {
  root.innerHTML = "";

  if (videos.length === 0) {
    root.innerHTML = `<p class="empty">No videos yet.</p>`;
    return;
  }

  const container = document.createElement("div");
  container.className = CONTAINER_CLASS[view] ?? CONTAINER_CLASS.carousel;
  const showTitle = SHOWS_TITLE[view] ?? false;
  for (const video of videos) {
    container.appendChild(renderThumb(video, onOpenExternal, showTitle));
  }
  root.appendChild(container);
}
