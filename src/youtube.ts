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
  // Not rendered by the widget (thumbnails only) — this is signal for the
  // model's own reasoning about which video actually fits the question,
  // beyond what YouTube's keyword search ranking surfaced.
  tags?: string[];
  // Set by mcp-server.ts after this module returns, for the top few
  // results only, when SUPADATA_API_KEY is configured — see
  // src/transcript.ts. Not fetched here since this module only knows
  // about the YouTube Data API.
  transcript?: string;
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

// search.list's snippet.description is truncated to ~100-150 chars with a
// trailing "...". videos.list's snippet.description is the full thing (we
// saw one run 1,300+ chars, plus up to ~40 tags) — that's the real
// substrate for semantic matching, so every result gets a second-pass
// lookup here rather than trusting the truncated search snippet.
interface YoutubeVideoDetails {
  duration?: string;
  description?: string;
  tags?: string[];
}

// Descriptions can run long (sponsor links, disclaimers, hashtags). Full
// text is still fetched — capping only what's handed to the model keeps
// payloads bounded without losing the topic-relevant opening.
const DESCRIPTION_LIMIT = 600;
const MAX_TAGS = 20;

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

function truncate(text: string, max: number): string {
  const trimmed = text.trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max).trimEnd()}…`;
}

// Batches videos.list lookups (id accepts up to 50 comma-separated) to
// pull duration plus the full snippet (untruncated description, tags) for
// a set of video IDs. Best-effort: a failed batch just leaves those videos
// without the extra detail rather than failing the whole search.
async function fetchVideoDetails(
  videoIds: string[],
  apiKey: string,
): Promise<Map<string, YoutubeVideoDetails>> {
  const details = new Map<string, YoutubeVideoDetails>();

  for (let i = 0; i < videoIds.length; i += 50) {
    const batch = videoIds.slice(i, i + 50);
    try {
      const detailsUrl = new URL(`${API_BASE}/videos`);
      detailsUrl.searchParams.set("part", "snippet,contentDetails");
      detailsUrl.searchParams.set("id", batch.join(","));
      detailsUrl.searchParams.set("key", apiKey);
      const res = await fetch(detailsUrl);
      if (!res.ok) continue;

      const data = (await res.json()) as {
        items?: {
          id: string;
          snippet?: { description?: string; tags?: string[] };
          contentDetails?: { duration?: string };
        }[];
      };
      for (const item of data.items ?? []) {
        details.set(item.id, {
          duration: item.contentDetails?.duration ? formatDuration(item.contentDetails.duration) : undefined,
          description: item.snippet?.description,
          tags: item.snippet?.tags,
        });
      }
    } catch {
      // Non-fatal — the search snippet's truncated description/no tags is
      // still a usable fallback for this batch.
    }
  }

  return details;
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
  const details = await fetchVideoDetails(videoIds, apiKey);

  return items.map((item) => {
    const videoId = item.id.videoId as string;
    const thumbnails = item.snippet.thumbnails ?? {};
    const thumbnail =
      // medium (mqdefault, 320x180) is natively 16:9; high (hqdefault) is
      // 480x360 letterboxed with black bars, which object-fit: cover was
      // cropping into rather than showing clean.
      thumbnails.medium?.url ?? thumbnails.high?.url ?? thumbnails.default?.url ?? "";

    const detail = details.get(videoId);
    const fullDescription = detail?.description ?? item.snippet.description;

    return {
      videoId,
      title: item.snippet.title,
      description: truncate(fullDescription, DESCRIPTION_LIMIT),
      thumbnail,
      publishedAt: item.snippet.publishedAt,
      url: `https://www.youtube.com/watch?v=${videoId}`,
      duration: detail?.duration,
      channelTitle: item.snippet.channelTitle,
      tags: detail?.tags?.slice(0, MAX_TAGS),
    };
  });
}
