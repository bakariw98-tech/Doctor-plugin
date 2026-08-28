// src/youtube.ts
// Thin client around the YouTube Data API v3, scoped to a single configured
// channel (the doctor's channel).

const API_BASE = "https://www.googleapis.com/youtube/v3";

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

interface YoutubeThumbnail {
  url: string;
}

interface YoutubeSearchItem {
  id: { videoId?: string };
  snippet: {
    title: string;
    description: string;
    publishedAt: string;
    channelTitle: string;
    thumbnails: Record<string, YoutubeThumbnail>;
  };
}

let resolvedChannelId: string | null = null;

// The channel can be configured either as a raw channel ID (starts with
// "UC...") or as a public @handle, which is easier to find but needs one
// extra API call to resolve into an ID. The result is cached for the life
// of the process.
async function resolveChannelId(apiKey: string): Promise<string> {
  if (resolvedChannelId) return resolvedChannelId;

  const configuredId = process.env.YOUTUBE_CHANNEL_ID?.trim();
  if (configuredId) {
    resolvedChannelId = configuredId;
    return configuredId;
  }

  const handle = process.env.YOUTUBE_CHANNEL_HANDLE?.trim();
  if (!handle) {
    throw new Error(
      "Set YOUTUBE_CHANNEL_ID or YOUTUBE_CHANNEL_HANDLE in the environment (see .env.example).",
    );
  }

  const url = new URL(`${API_BASE}/channels`);
  url.searchParams.set("part", "id");
  url.searchParams.set("forHandle", handle.replace(/^@/, ""));
  url.searchParams.set("key", apiKey);

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to resolve channel handle "${handle}": ${res.status} ${await res.text()}`);
  }
  const data = (await res.json()) as { items?: { id: string }[] };
  const id = data.items?.[0]?.id;
  if (!id) {
    throw new Error(`No channel found for handle "${handle}".`);
  }
  resolvedChannelId = id;
  return id;
}

// Converts an ISO-8601 duration like "PT1H2M3S" into "1:02:03".
function formatDuration(iso: string): string {
  const match = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!match) return "";
  const hours = Number(match[1] ?? 0);
  const minutes = Number(match[2] ?? 0);
  const seconds = Number(match[3] ?? 0);

  const mm = hours ? String(minutes).padStart(2, "0") : String(minutes);
  const ss = String(seconds).padStart(2, "0");
  return hours ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`;
}

export async function searchChannelVideos(
  query: string,
  maxResults = 8,
): Promise<VideoResult[]> {
  const apiKey = process.env.YOUTUBE_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("Set YOUTUBE_API_KEY in the environment (see .env.example).");
  }

  const channelId = await resolveChannelId(apiKey);
  const clampedMax = Math.min(Math.max(maxResults, 1), 20);

  const searchUrl = new URL(`${API_BASE}/search`);
  searchUrl.searchParams.set("part", "snippet");
  searchUrl.searchParams.set("channelId", channelId);
  searchUrl.searchParams.set("q", query);
  searchUrl.searchParams.set("type", "video");
  searchUrl.searchParams.set("order", "relevance");
  searchUrl.searchParams.set("maxResults", String(clampedMax));
  searchUrl.searchParams.set("key", apiKey);

  const searchRes = await fetch(searchUrl);
  if (!searchRes.ok) {
    throw new Error(`YouTube search failed: ${searchRes.status} ${await searchRes.text()}`);
  }
  const searchData = (await searchRes.json()) as { items?: YoutubeSearchItem[] };
  const items = (searchData.items ?? []).filter((item) => item.id.videoId);

  if (items.length === 0) return [];

  const videoIds = items.map((item) => item.id.videoId as string);

  // A second call fetches duration, which search.list doesn't return.
  // Best-effort: if it fails, we still show results without durations.
  const durations = new Map<string, string>();
  try {
    const detailsUrl = new URL(`${API_BASE}/videos`);
    detailsUrl.searchParams.set("part", "contentDetails");
    detailsUrl.searchParams.set("id", videoIds.join(","));
    detailsUrl.searchParams.set("key", apiKey);
    const detailsRes = await fetch(detailsUrl);
    if (detailsRes.ok) {
      const detailsData = (await detailsRes.json()) as {
        items?: { id: string; contentDetails?: { duration?: string } }[];
      };
      for (const item of detailsData.items ?? []) {
        if (item.contentDetails?.duration) {
          durations.set(item.id, formatDuration(item.contentDetails.duration));
        }
      }
    }
  } catch {
    // Non-fatal — durations are a nice-to-have.
  }

  return items.map((item) => {
    const videoId = item.id.videoId as string;
    const thumbnails = item.snippet.thumbnails ?? {};
    const thumbnail =
      thumbnails.high?.url ?? thumbnails.medium?.url ?? thumbnails.default?.url ?? "";

    return {
      videoId,
      title: item.snippet.title,
      description: item.snippet.description,
      thumbnail,
      publishedAt: item.snippet.publishedAt,
      url: `https://www.youtube.com/watch?v=${videoId}`,
      duration: durations.get(videoId),
      channelTitle: item.snippet.channelTitle,
    };
  });
}
