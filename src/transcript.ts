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

// Transcripts can run to thousands of words; this bounds what gets stored
// per video. Was 3000 (~2-3 minutes of dense speech) — found live to be
// far too tight: a 16-minute video got cut off before reaching content
// well within the first half, so a question answered later in a longer
// video silently had no data to draw from. 15000 (~12-15 minutes of
// speech) covers the large majority of this channel's videos in full;
// very long streams (an hour-plus Q&A) still get cut, but that's a much
// smaller gap than before. mcp-server.ts applies its own tighter budget
// per response on top of this, since several long transcripts in one
// reply could otherwise blow past what a host will accept.
const TRANSCRIPT_LIMIT = 15000;

// The point of pulling transcripts at all: someone can ask a hyper-specific
// question ("what did he say about how much protein to eat?") and the model
// should be able to point to roughly where in the video that's answered —
// "around 4:20" — not just confirm the topic is covered somewhere. So we
// deliberately do NOT request Supadata's flat text=true mode; omitting
// `text` returns an array of {text, offset, duration} segments (offset/
// duration in ms) instead, which we fold into inline "[MM:SS]" markers
// dropped into the flowing text every TIMESTAMP_INTERVAL_MS at most — sparse
// enough not to eat the character budget above, dense enough to answer
// "when does he talk about X."
const TIMESTAMP_INTERVAL_MS = 20_000;

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

interface TranscriptSegment {
  text: string;
  offset: number;
  duration?: number;
  lang?: string;
}

interface SupadataTranscriptResponse {
  content?: TranscriptSegment[];
  lang?: string;
}

interface SupadataJobResponse {
  jobId?: string;
}

interface SupadataJobStatusResponse {
  status?: "queued" | "active" | "completed" | "failed";
  content?: TranscriptSegment[];
  error?: unknown;
}

function truncate(text: string, max: number): string {
  const trimmed = text.trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max).trimEnd()}…`;
}

// mm:ss under an hour, h:mm:ss at or beyond — matches formatDuration's style
// in youtube.ts.
function formatTimestamp(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const mm = hours ? String(minutes).padStart(2, "0") : String(minutes);
  const ss = String(seconds).padStart(2, "0");
  return hours ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`;
}

// Flattens timed segments into one string, dropping an inline "[MM:SS]"
// marker in front of the first segment past each TIMESTAMP_INTERVAL_MS
// window so the result reads naturally but still carries roughly-located
// timestamps a model can quote back.
function formatSegments(segments: TranscriptSegment[]): string {
  let out = "";
  let lastMarkerOffset = -Infinity;
  for (const segment of segments) {
    const text = segment.text?.trim();
    if (!text) continue;
    if (segment.offset - lastMarkerOffset >= TIMESTAMP_INTERVAL_MS) {
      out += `${out ? " " : ""}[${formatTimestamp(segment.offset)}] `;
      lastMarkerOffset = segment.offset;
    }
    out += `${text} `;
  }
  return out.trim();
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

async function pollJob(jobId: string, apiKey: string): Promise<TranscriptSegment[] | null> {
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
export interface TranscriptOutcome {
  transcript: string | null;
  definitive: boolean;
  // Specifically "we've hit the account's rate/usage limit," distinct from
  // an ordinary transient failure — a caller fetching many videos in a
  // loop should treat this as "stop now," not "skip this one and keep
  // going," since every remaining request will fail the same way until
  // the limit resets.
  rateLimited?: boolean;
}

async function fetchTranscriptUncached(videoUrl: string, apiKey: string): Promise<TranscriptOutcome> {
  try {
    const url = new URL(`${API_BASE}/transcript`);
    url.searchParams.set("url", videoUrl);
    url.searchParams.set("mode", "native");
    // No `text=true` — deliberately requesting the segmented
    // {text, offset, duration}[] shape (see TIMESTAMP_INTERVAL_MS above)
    // instead of one flat string, so timestamps survive into the stored
    // transcript.

    const res = await fetchWithTimeout(url, apiKey);

    // Video doesn't exist, is private, or is otherwise inaccessible —
    // that's not going to change on retry, so it's safe to cache.
    if (res.status === 404 || res.status === 403) {
      return { transcript: null, definitive: true };
    }
    // The account's rate/usage limit — a distinct, detectable case, not
    // just "some other non-OK status." Never cache or treat as "no
    // transcript"; a bulk caller should stop entirely rather than burn
    // through the rest of its list hitting the same wall.
    if (res.status === 429) {
      return { transcript: null, definitive: false, rateLimited: true };
    }
    // Anything else non-OK (server error, ...) is worth retrying later
    // rather than remembering as "no transcript" forever.
    if (!res.ok) {
      return { transcript: null, definitive: false };
    }

    const data = (await res.json()) as SupadataTranscriptResponse & SupadataJobResponse;
    if (data.jobId) {
      const segments = await pollJob(data.jobId, apiKey);
      // A poll that ran out of attempts without resolving is ambiguous,
      // not a confirmed "no transcript" — don't cache that as permanent.
      return {
        transcript: segments?.length ? truncate(formatSegments(segments), TRANSCRIPT_LIMIT) : null,
        definitive: segments !== null,
      };
    }

    // A 200 with empty/missing content is Supadata's real "no native
    // transcript for this video" answer (their 206 case) — definitive,
    // and still billed, so it's exactly the case worth caching.
    return {
      transcript: data.content?.length ? truncate(formatSegments(data.content), TRANSCRIPT_LIMIT) : null,
      definitive: true,
    };
  } catch {
    return { transcript: null, definitive: false };
  }
}

/**
 * Fetches the native-caption transcript for one video. Never throws — every
 * failure mode here comes back as `transcript: null`, not an exception.
 * Callers MUST check `definitive` before treating a null transcript as
 * permanent: `false` means the request didn't resolve one way or the other
 * (timeout, server error, or — flagged separately via `rateLimited` — the
 * account's usage limit), so it should be retried later, not recorded as
 * "this video has no transcript." Cached by video ID (see the module-level
 * `cache` above) only when `definitive` is true, so a video already
 * confirmed one way or the other this process is never paid for again,
 * while an unresolved one gets a fresh try on the next call.
 */
export async function fetchTranscript(videoUrl: string, apiKey: string): Promise<TranscriptOutcome> {
  const id = videoIdFromUrl(videoUrl);
  const cached = cache.get(id);
  if (cached !== undefined) return { transcript: cached, definitive: true };

  const outcome = await fetchTranscriptUncached(videoUrl, apiKey);
  if (outcome.definitive) cache.set(id, outcome.transcript);
  return outcome;
}
