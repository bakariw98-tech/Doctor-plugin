// src/transcript.ts
// Thin client around Supadata's transcript API (https://supadata.ai).
//
// This is an OFFLINE-only tool now: the only caller is
// scripts/fetch-transcripts.ts, run manually to build data/transcripts.json.
// The deployed server never imports this file and never calls Supadata at
// request time — it reads the pre-built dataset instead (see
// src/generated/transcripts.ts and mcp-server.ts). Keeping the live app free
// of a third-party paid-API dependency matters because it needs to pass
// OpenAI Apps SDK review; Supadata is used to build our own data, once,
// offline, not as a feature of the app itself.
//
// Deliberate limits, all about staying inside a small credit budget
// rather than the API's actual capabilities (the account this runs
// against has roughly a 100-transcript allowance):
//
// 1. mode is always "native" — only an existing caption track is fetched,
//    never AI-generated. Generation is priced per minute of video (2
//    credits/min) and can take up to ~2 minutes per video; native is a
//    flat 1 credit and stays fast, since it's just downloading captions
//    that already exist. A video with no captions simply has no
//    transcript here rather than paying to create one.
// 2. Every outcome — a real transcript, or a confirmed "this video has
//    none" — is cached by video ID (see below) for the duration of a
//    single fetch-transcripts.ts run, so the same video is never paid for
//    twice in one run. The real cross-run idempotency (skipping videos
//    already in data/transcripts.json entirely) lives in
//    fetch-transcripts.ts itself.
// 3. A 206 "transcript unavailable" response still costs 1 credit per
//    Supadata's pricing, same as a successful fetch, so caching the
//    negative result matters just as much as caching the positive one.

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

// Process-lifetime cache, keyed by video ID: `null` means "we asked and
// confirmed this video has no transcript," not "we haven't checked yet"
// (absence from the map means the latter). This is a plain in-memory Map,
// not a persistent store — it survives repeated calls within one warm
// process (the whole session for local dev via server.ts; a given warm
// Vercel Lambda instance in production) but resets on a cold start or a
// new deployment. That's a real gap if the ~100-credit budget needs a
// hard guarantee across restarts — ask if that's needed and it's worth
// backing this with Vercel KV or similar instead of process memory.
const cache = new Map<string, string | null>();

function videoIdFromUrl(videoUrl: string): string {
  try {
    return new URL(videoUrl).searchParams.get("v") ?? videoUrl;
  } catch {
    return videoUrl;
  }
}

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

// A "definitive" outcome (real content, or a confirmed no-transcript
// response) gets cached; a transient failure (timeout, rate limit, server
// error) does not, so a later call for the same video gets a fresh try
// instead of being stuck on a bad result forever.
interface TranscriptOutcome {
  transcript: string | null;
  definitive: boolean;
}

async function fetchTranscriptUncached(videoUrl: string, apiKey: string): Promise<TranscriptOutcome> {
  try {
    const url = new URL(`${API_BASE}/transcript`);
    url.searchParams.set("url", videoUrl);
    url.searchParams.set("text", "true");
    url.searchParams.set("mode", "native");

    const res = await fetchWithTimeout(url, apiKey);

    // Video doesn't exist, is private, or is otherwise inaccessible —
    // that's not going to change on retry, so it's safe to cache.
    if (res.status === 404 || res.status === 403) {
      return { transcript: null, definitive: true };
    }
    // Anything else non-OK (rate limited, server error, ...) is worth
    // retrying later rather than remembering as "no transcript" forever.
    if (!res.ok) {
      return { transcript: null, definitive: false };
    }

    const data = (await res.json()) as SupadataTranscriptResponse & SupadataJobResponse;
    if (data.jobId) {
      const content = await pollJob(data.jobId, apiKey);
      // A poll that ran out of attempts without resolving is ambiguous,
      // not a confirmed "no transcript" — don't cache that as permanent.
      return { transcript: content ? truncate(content, TRANSCRIPT_LIMIT) : null, definitive: content !== null };
    }

    // A 200 with empty/missing content is Supadata's real "no native
    // transcript for this video" answer (their 206 case) — definitive,
    // and still billed, so it's exactly the case worth caching.
    return { transcript: data.content ? truncate(data.content, TRANSCRIPT_LIMIT) : null, definitive: true };
  } catch {
    return { transcript: null, definitive: false };
  }
}

/**
 * Fetches the native-caption transcript for one video, or `null` if none
 * exists, the video isn't accessible, or the request didn't resolve in
 * time. Never throws — every failure mode here is "no transcript for this
 * video," not a reason to fail the whole search. Cached by video ID (see
 * the module-level `cache` above) so a video already checked this process
 * is never paid for again.
 */
export async function fetchTranscript(videoUrl: string, apiKey: string): Promise<string | null> {
  const id = videoIdFromUrl(videoUrl);
  const cached = cache.get(id);
  if (cached !== undefined) return cached;

  const outcome = await fetchTranscriptUncached(videoUrl, apiKey);
  if (outcome.definitive) cache.set(id, outcome.transcript);
  return outcome.transcript;
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
