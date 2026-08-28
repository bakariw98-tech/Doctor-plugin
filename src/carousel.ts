// src/carousel.ts
// Shared rendering logic for the video carousel. Used by both the MCP App
// widget (src/mcp-app.ts, driven by the host bridge) and the standalone
// browser demo (src/demo.ts, driven by a plain REST call), so both stay
// visually and behaviorally identical.

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

/**
 * Renders the carousel into `root`. `playingId`, when set, expands that
 * card into a live YouTube embed instead of a thumbnail. `onPlay(videoId)`
 * fires when a thumbnail is clicked; `onClose()` fires when the open
 * player's close button is clicked. `onOpenExternal(url)` fires when
 * "Watch on YouTube" is clicked — a fallback for hosts whose iframe
 * sandbox doesn't allow the embed (the embed itself can silently fail
 * depending on host CSP support, so this is always shown, not just on
 * error).
 */
export function renderCarousel(
  root: HTMLElement,
  videos: VideoResult[],
  playingId: string | null,
  onPlay: (videoId: string) => void,
  onClose: () => void,
  onOpenExternal: (url: string) => void,
) {
  root.innerHTML = "";

  if (videos.length === 0) {
    root.innerHTML = `<p class="empty">No videos yet. Try a search above.</p>`;
    return;
  }

  const track = document.createElement("div");
  track.className = "carousel-track";

  for (const video of videos) {
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
        <div class="player-actions">
          <button class="close-btn" type="button">Close</button>
          <button class="open-external-btn" type="button">Watch on YouTube ↗</button>
        </div>
      `;
      card.querySelector(".close-btn")!.addEventListener("click", onClose);
      card
        .querySelector(".open-external-btn")!
        .addEventListener("click", () => onOpenExternal(video.url));
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
      card.querySelector(".thumb-btn")!.addEventListener("click", () => onPlay(video.videoId));
    }

    track.appendChild(card);
  }

  root.appendChild(track);
}
