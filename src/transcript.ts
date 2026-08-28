// src/transcript.ts
// Thin client around Supadata's transcript API (https://supadata.ai), used
// to give the model the actual spoken content of a video — not just its
// title/description/tags — for judging whether it really answers the
// question, and for speaking about it accurately in the reply.
//
// Two deliberate limits, both about cost and latency rather than the API's
// capabilities:
//
// 1. mode is always "native" — only an existing caption track is fetched,
//    never AI-generated. Generation is priced per minute of video (2
//    credits/min) and can take up to ~2 minutes per video; native is a
//    flat 1 credit and stays fast, since it's just downloading captions
//    that already exist. A video with no captions simply has no
//    transcript here rather than paying to create one.
// 2. Only called for a small, bounded number of videos per search (see
//    mcp-server.ts) — never for every result in a large carousel, and
//    never from the plain REST demo endpoint (api/search.ts), which has
//    no agent in the loop to read a transcript anyway.

const API_BASE = "https://api.supadata.ai/v1";

// Transcripts can run to thousands of words; this bounds what actually
// gets handed to the model (and billed in its context), same spirit as
// the description cap in youtube.ts but roomier since this is the
// primary substrate for judging content, not a supporting snippet.
const TRANSCRIPT_LIMIT = 3000;

// Native-caption fetches should resolve quickly, but stay defensive: cap
// the request itself and the (unlikely, for native mode) async-job poll
// so one slow video can't stall the whole tool call inside a serverless
// function's request timeout.
const REQUEST_TIMEOUT_MS = 8000;
const MAX_POLL_ATTEMPTS = 6;
const POLL_INTERVAL_MS = 1000;

interface SupadataTranscriptResponse {
  content?: string;
  lang?: string;
}

interface SupadataJobResponse {
  jobId?: string;
}

interface SupadataJobStatusResponse {
  status?: "queued" | "active" | "completed" | "failed";
  content?: string;
  error?: unknown;
}

function truncate(text: string, max: number): string {
  const trimmed = text.trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max).trimEnd()}…`;
}

async function fetchWithTimeout(url: URL, apiKey: string): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, { headers: { "x-api-key": apiKey }, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function pollJob(jobId: string, apiKey: string): Promise<string | null> {
  for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    try {
      const res = await fetchWithTimeout(new URL(`${API_BASE}/transcript/${jobId}`), apiKey);
      if (!res.ok) continue;
      const data = (await res.json()) as SupadataJobStatusResponse;
      if (data.status === "completed") return data.content ?? null;
      if (data.status === "failed") return null;
      // queued / active — keep polling.
    } catch {
      // Transient — try again until MAX_POLL_ATTEMPTS runs out.
    }
  }
  return null;
}

/**
 * Fetches the native-caption transcript for one video, or `null` if none
 * exists, the video isn't accessible, or the request didn't resolve in
 * time. Never throws — every failure mode here is "no transcript for this
 * video," not a reason to fail the whole search.
 */
export async function fetchTranscript(videoUrl: string, apiKey: string): Promise<string | null> {
  try {
    const url = new URL(`${API_BASE}/transcript`);
    url.searchParams.set("url", videoUrl);
    url.searchParams.set("text", "true");
    url.searchParams.set("mode", "native");

    const res = await fetchWithTimeout(url, apiKey);
    if (!res.ok) return null;

    const data = (await res.json()) as SupadataTranscriptResponse & SupadataJobResponse;
    if (data.jobId) {
      const content = await pollJob(data.jobId, apiKey);
      return content ? truncate(content, TRANSCRIPT_LIMIT) : null;
    }

    return data.content ? truncate(data.content, TRANSCRIPT_LIMIT) : null;
  } catch {
    return null;
  }
}

/**
 * Fetches transcripts for several videos in parallel. Returns a Map from
 * videoUrl to transcript text; a video with no entry means no transcript
 * was available (not an error — the caller just has less to work with for
 * that one).
 */
export async function fetchTranscripts(
  videoUrls: string[],
  apiKey: string,
): Promise<Map<string, string>> {
  const results = await Promise.allSettled(
    videoUrls.map(async (url) => [url, await fetchTranscript(url, apiKey)] as const),
  );

  const transcripts = new Map<string, string>();
  for (const result of results) {
    if (result.status === "fulfilled" && result.value[1]) {
      transcripts.set(result.value[0], result.value[1]);
    }
  }
  return transcripts;
}
