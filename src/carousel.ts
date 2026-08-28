// src/carousel.ts
// Shared rendering logic for video results. Used by both the MCP App
// widget (src/mcp-app.ts, driven by the host bridge) and the standalone
// browser demo (src/demo.ts, driven by a plain REST call), so both stay
// visually and behaviorally identical.
//
// The widget renders thumbnails and nothing else — no title, date,
// channel name, or description. Every word is the agent's, spoken above
// the widget in the chat; drawing text inside the component here would
// duplicate what the agent already said, and there's no "why this
// matched" text worth fabricating from title-only search data yet (see
// design/README.md). One tap opens the video externally via
// onOpenExternal (app.openLink in the widget, window.open in the demo) —
// no inline player, no second "watch" affordance.

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

// The one shared unit: a thumbnail, a duration chip, a hover play cue.
// Every layout below is just this, in a different container.
function renderThumb(video: VideoResult, onOpenExternal: (url: string) => void): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "shot";
  btn.setAttribute("aria-label", `Watch ${video.title}`);
  btn.innerHTML = `
    <img src="${video.thumbnail}" alt="" loading="lazy" />
    ${video.duration ? `<span class="dur">${escapeHtml(video.duration)}</span>` : ""}
    <span class="cue">${PLAY_ICON}</span>
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

/**
 * Renders `videos` into `root` in the given view — a container shaped for
 * the result count (solo / split-to-fit / scrolling strip / wrapping
 * wall), holding nothing but thumbnails. `onOpenExternal(url)` fires on
 * tap.
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
  for (const video of videos) {
    container.appendChild(renderThumb(video, onOpenExternal));
  }
  root.appendChild(container);
}
