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
  // Looked up from a pre-built local dataset (src/generated/transcripts.ts,
  // produced offline by scripts/fetch-transcripts.ts) — never fetched live
  // by the running server. See that script for why.
  transcript?: string;
}

interface YoutubeThumbnail {
  url: string;
}

interface YoutubeSnippet {
  title: string;
  description: string;
  publishedAt: string;
  channelTitle: string;
  thumbnails: Record<string, YoutubeThumbnail>;
}

interface YoutubeItem {
  videoId: string;
  snippet: YoutubeSnippet;
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
let resolvedUploadsPlaylistId: string | null = null;

function requireApiKey(): string {
  const apiKey = process.env.YOUTUBE_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("Set YOUTUBE_API_KEY in the environment (see .env.example).");
  }
  return apiKey;
}

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

// Every channel has one "uploads" playlist containing all its public
// videos in upload order — the cheap (1 quota unit/page), reliable way to
// enumerate a channel's catalog, as opposed to search.list (100 units,
// and scoped to a query rather than "everything").
async function resolveUploadsPlaylistId(apiKey: string): Promise<string> {
  if (resolvedUploadsPlaylistId) return resolvedUploadsPlaylistId;

  const channelId = await resolveChannelId(apiKey);
  const url = new URL(`${API_BASE}/channels`);
  url.searchParams.set("part", "contentDetails");
  url.searchParams.set("id", channelId);
  url.searchParams.set("key", apiKey);

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to resolve uploads playlist: ${res.status} ${await res.text()}`);
  }
  const data = (await res.json()) as {
    items?: { contentDetails?: { relatedPlaylists?: { uploads?: string } } }[];
  };
  const uploads = data.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;
  if (!uploads) {
    throw new Error("Could not resolve the channel's uploads playlist.");
  }
  resolvedUploadsPlaylistId = uploads;
  return uploads;
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

function buildVideoResult(item: YoutubeItem, details: Map<string, YoutubeVideoDetails>): VideoResult {
  const thumbnails = item.snippet.thumbnails ?? {};
  const thumbnail =
    // medium (mqdefault, 320x180) is natively 16:9; high (hqdefault) is
    // 480x360 letterboxed with black bars, which object-fit: cover was
    // cropping into rather than showing clean.
    thumbnails.medium?.url ?? thumbnails.high?.url ?? thumbnails.default?.url ?? "";

  const detail = details.get(item.videoId);
  const fullDescription = detail?.description ?? item.snippet.description;

  return {
    videoId: item.videoId,
    title: item.snippet.title,
    description: truncate(fullDescription, DESCRIPTION_LIMIT),
    thumbnail,
    publishedAt: item.snippet.publishedAt,
    url: `https://www.youtube.com/watch?v=${item.videoId}`,
    duration: detail?.duration,
    channelTitle: item.snippet.channelTitle,
    tags: detail?.tags?.slice(0, MAX_TAGS),
  };
}

/**
 * Fetches full video details for a specific set of video IDs directly
 * (videos.list, not a search) — one call, no ranking involved. Used to
 * pull in videos that a local transcript-content match surfaced but
 * YouTube's own keyword search didn't return, so they can be presented
 * with the same full data (thumbnail, description, tags, duration) as any
 * other result. Best-effort per batch, same as fetchVideoDetails.
 */
export async function getVideosByIds(videoIds: string[]): Promise<VideoResult[]> {
  if (videoIds.length === 0) return [];
  const apiKey = requireApiKey();
  const results: VideoResult[] = [];

  for (let i = 0; i < videoIds.length; i += 50) {
    const batch = videoIds.slice(i, i + 50);
    try {
      const url = new URL(`${API_BASE}/videos`);
      url.searchParams.set("part", "snippet,contentDetails");
      url.searchParams.set("id", batch.join(","));
      url.searchParams.set("key", apiKey);

      const res = await fetch(url);
      if (!res.ok) continue;

      const data = (await res.json()) as {
        items?: {
          id: string;
          snippet: YoutubeSnippet & { tags?: string[] };
          contentDetails?: { duration?: string };
        }[];
      };
      for (const item of data.items ?? []) {
        results.push(
          buildVideoResult(
            { videoId: item.id, snippet: item.snippet },
            new Map([
              [
                item.id,
                {
                  duration: item.contentDetails?.duration
                    ? formatDuration(item.contentDetails.duration)
                    : undefined,
                  description: item.snippet.description,
                  tags: item.snippet.tags,
                },
              ],
            ]),
          ),
        );
      }
    } catch {
      // Non-fatal — a video that fails to fetch here just doesn't get
      // added to the result set.
    }
  }

  return results;
}

export async function searchChannelVideos(
  query: string,
  maxResults = 8,
): Promise<VideoResult[]> {
  const apiKey = requireApiKey();
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
  const searchData = (await searchRes.json()) as {
    items?: { id: { videoId?: string }; snippet: YoutubeSnippet }[];
  };
  const items: YoutubeItem[] = (searchData.items ?? [])
    .filter((item) => item.id.videoId)
    .map((item) => ({ videoId: item.id.videoId as string, snippet: item.snippet }));

  if (items.length === 0) return [];

  const details = await fetchVideoDetails(
    items.map((item) => item.videoId),
    apiKey,
  );
  return items.map((item) => buildVideoResult(item, details));
}

/**
 * Enumerates the channel's own upload catalog directly (via its uploads
 * playlist), most recent first — not a keyword search. This is what the
 * offline transcript-fetching script (scripts/fetch-transcripts.ts) uses
 * to build the pool of videos it pulls transcripts for; the running
 * server never calls this at request time.
 */
export async function listChannelVideos(limit = 100): Promise<VideoResult[]> {
  const apiKey = requireApiKey();
  const playlistId = await resolveUploadsPlaylistId(apiKey);

  const items: YoutubeItem[] = [];
  let pageToken: string | undefined;

  while (items.length < limit) {
    const url = new URL(`${API_BASE}/playlistItems`);
    url.searchParams.set("part", "snippet");
    url.searchParams.set("playlistId", playlistId);
    url.searchParams.set("maxResults", String(Math.min(50, limit - items.length)));
    if (pageToken) url.searchParams.set("pageToken", pageToken);
    url.searchParams.set("key", apiKey);

    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`Failed to list channel uploads: ${res.status} ${await res.text()}`);
    }
    const data = (await res.json()) as {
      items?: { snippet: YoutubeSnippet & { resourceId: { videoId: string } } }[];
      nextPageToken?: string;
    };
    for (const item of data.items ?? []) {
      items.push({ videoId: item.snippet.resourceId.videoId, snippet: item.snippet });
    }

    pageToken = data.nextPageToken;
    if (!pageToken) break;
  }

  const capped = items.slice(0, limit);
  if (capped.length === 0) return [];

  const details = await fetchVideoDetails(
    capped.map((item) => item.videoId),
    apiKey,
  );
  return capped.map((item) => buildVideoResult(item, details));
}
