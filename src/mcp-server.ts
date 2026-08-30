// src/mcp-server.ts
// Builds a configured McpServer instance. Shared by the local dev server
// (server.ts, Express + long-lived process) and the Vercel serverless
// function (api/mcp.ts, one instance per request) so both stay in sync.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  registerAppTool,
  registerAppResource,
  RESOURCE_MIME_TYPE,
} from "@modelcontextprotocol/ext-apps/server";
import { z } from "zod";
import { searchChannelVideos, getVideosByIds, type VideoResult } from "./youtube.js";
import { findTranscriptMatches, scoreTranscript } from "./transcript-search.js";
import { WIDGET_HTML } from "./generated/widget-html.js";
import { TRANSCRIPTS } from "./generated/transcripts.js";
import { getMagnetConfig, listQuestions, insertLead } from "./db.js";

// The ui:// scheme tells hosts this is an MCP App resource. The path
// structure is arbitrary; it just needs to match the tool's outputTemplate.
export const RESOURCE_URI = "ui://search-doctor-videos/mcp-app.html";

// Total transcript characters allowed in one response, across every video
// returned. Each stored transcript can run up to 15000 chars on its own
// (see TRANSCRIPT_LIMIT in transcript.ts) — fine for one video, but
// maxResults defaults to 8, and several long transcripts in the same
// response could push past what a host is willing to accept in a single
// tool result. This budget is shared out below rather than applied as a
// flat per-video cap, so a search that surfaces one long relevant video
// alongside several short ones doesn't truncate the one that matters just
// because of a fixed per-video ceiling.
const TOTAL_TRANSCRIPT_BUDGET = 24000;

// Some MCP hosts only feed the model this tool's `content` text — the
// structured `structuredContent.videos` (full description, tags,
// transcript) is delivered to the widget's iframe, not necessarily back
// into the model's own context. So the actual reasoning material has to
// live here too, or the model is answering blind: it'll see thumbnails on
// screen but have no idea what's actually in them. Confirmed live against
// Claude's web connector, which never saw a transcript that was only in
// structuredContent.
function parseTimeToSeconds(time: string): number | null {
  const parts = time.split(":").map(Number);
  if (parts.some((n) => Number.isNaN(n))) return null;
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return null;
}

// If a stored transcript's last "[MM:SS]" marker falls well short of the
// video's actual duration, the transcript doesn't cover the whole video —
// found live: a transcript fetched under an old, since-raised character
// cap stopped at 2:29 of an 11:59 video, and rather than saying so, the
// model speculated about specific content and terminology that might be
// later in the video (a ranked list's later items) with no evidence for
// any of it. This flags the gap explicitly so that doesn't happen again.
const COVERAGE_GAP_THRESHOLD = 0.85; // transcript covers less than this fraction of the video

function coverageNote(transcript: string, duration: string | undefined): string {
  if (!duration) return "";
  const totalSeconds = parseTimeToSeconds(duration);
  if (!totalSeconds) return "";

  const markers = [...transcript.matchAll(/\[(\d+(?::\d{2}){1,2})\]/g)];
  const lastMarker = markers[markers.length - 1]?.[1];
  if (!lastMarker) return "";
  const lastSeconds = parseTimeToSeconds(lastMarker);
  if (lastSeconds === null) return "";

  if (lastSeconds < totalSeconds * COVERAGE_GAP_THRESHOLD) {
    return (
      `\nCOVERAGE GAP: this stored transcript only reaches about [${lastMarker}] of a ${duration} ` +
      `video — everything after that point is NOT included in what you were given, no matter what ` +
      `the question is about. If the answer might be later in the video (common for a ranked list, ` +
      `chapter-based video, or anything over a few minutes long), say plainly that the available ` +
      `transcript data doesn't reach that part yet — do not guess or hypothesize specific content, ` +
      `terminology, or mechanisms for the part you can't see.`
    );
  }
  return "";
}

function buildResultText(query: string, videos: VideoResult[]): string {
  if (videos.length === 0) {
    return `No videos found about "${query}" on this channel. Try a different search term.`;
  }

  // Give every video an equal share of the total budget first; a video
  // with a shorter transcript (or none) leaves its unused share for the
  // others, distributed evenly across whoever still has more to give.
  const lengths = videos.map((v) => v.transcript?.length ?? 0);
  let remainingBudget = TOTAL_TRANSCRIPT_BUDGET;
  let remainingVideos = videos.length;
  const allotted = lengths.map((len) => {
    const share = Math.floor(remainingBudget / remainingVideos);
    const used = Math.min(len, share);
    remainingBudget -= used;
    remainingVideos -= 1;
    return used;
  });

  const entries = videos.map((v, i) => {
    const lines = [`"${v.title}" (${v.duration ?? "?"}, published ${v.publishedAt.slice(0, 10)})`];
    if (v.description) lines.push(`Description: ${v.description}`);
    if (v.tags?.length) lines.push(`Tags: ${v.tags.join(", ")}`);
    if (v.transcript) {
      // Explicit score + quoted evidence up front, not something to infer
      // from skimming the full transcript below — this is what actually
      // fixes "picked the video that felt related instead of the one with
      // real evidence": don't make the model judge relevance itself when
      // a concrete number and quote can do it instead.
      const { score, evidence } = scoreTranscript(query, v.transcript, TRANSCRIPTS);
      if (evidence) {
        lines.push(
          `Transcript match: score ${score.toFixed(1)} — most relevant moment at [${evidence.timestamp}]: ` +
            `"${evidence.quote}"`,
        );
      }

      const cap = allotted[i];
      const shown = v.transcript.slice(0, cap);
      const truncatedNote =
        cap < v.transcript.length
          ? " [cut off here to fit this reply — there is more transcript after this point that " +
            "isn't shown; say so rather than guessing about anything past it]"
          : "";
      lines.push(
        `Full transcript (has '[MM:SS]' markers roughly every 20s): ${shown}${truncatedNote}`,
      );

      const gapNote = coverageNote(v.transcript, v.duration);
      if (gapNote) lines.push(gapNote);
    } else {
      lines.push("Transcript: not available for this video.");
    }
    return lines.join("\n");
  });

  return (
    `${videos.length} video${videos.length === 1 ? "" : "s"} about "${query}":\n\n` +
    entries.join("\n\n---\n\n")
  );
}

// The Supabase Storage origin the widget needs on its CSP allowlist to
// actually load an uploaded cover photo — same env var src/storage.ts
// uploads to, so this only ever needs to be set once. Returns null (no
// entry added) rather than throwing when unset, since the resource
// registration below must succeed even without lead-capture configured.
function supabaseStorageOrigin(): string | null {
  const url = process.env.SUPABASE_URL?.trim();
  return url ? url.replace(/\/+$/, "") : null;
}

// Explicit ask: after every search, proactively mention the free offer
// (using its real title/description, not a generic "want a free guide?")
// and ask if they'd like it — rather than waiting for the person to bring
// it up first. Fails silent (returns "") on any error, e.g. no
// DATABASE_URL/DEMO_MODE configured yet — a lead-capture hiccup should
// never break the actual search results.
interface OfferSummary {
  title: string;
  description: string;
}

// Two independent channels for the same signal, not one: `hintText` goes
// into the tool's prose content (some hosts only feed the model that),
// and the caller also gets `offer` as a plain structured object for
// structuredContent — models trained heavily on function-calling often
// weight a clean, explicit field more reliably than a line of embedded
// prose, even though neither one is actually enforced (an MCP server has
// no way to force a host's model into a follow-up tool call either way;
// this only improves the odds it's noticed and acted on).
async function getFreeOffer(resultCount: number): Promise<{ hintText: string; offer: OfferSummary | null }> {
  if (resultCount === 0) return { hintText: "", offer: null };
  try {
    const magnet = await getMagnetConfig();
    if (!magnet.enabled) return { hintText: "", offer: null };
    // Placed FIRST in the tool result, ahead of the video details — see
    // the call site for why (some hosts truncate long tool-result text,
    // and a trailing hint after a big transcript blob can get cut off
    // silently before the model ever sees it).
    const hintText =
      `Note: there's also a free resource related to this topic, "${magnet.title}" — ${magnet.description} ` +
      `Worth mentioning in your reply, right after you present the video(s) below. ` +
      `Ask in your own words whether they'd like it (naming what it actually covers, not a generic ` +
      `"want a free guide?"), e.g. "There's also a free guide, '${magnet.title}', that covers ` +
      `${magnet.description.replace(/\.$/, "")} — want it?" Only call offer_lead_magnet if they clearly ` +
      `say yes to that question; if they decline or don't respond to it, don't call it, and don't ` +
      `bring the offer up again later in this same conversation once they've declined once.\n\n---\n\n`;
    return { hintText, offer: { title: magnet.title, description: magnet.description } };
  } catch {
    return { hintText: "", offer: null };
  }
}

// Explicit, asked-for modes rather than trying to infer "does this person
// want one video or several" from the query text — see the tool
// description, which tells the calling model to ask the person directly
// (① best / ② explore / ③ everything) when it isn't already obvious.
type Mode = "best" | "explore" | "everything";

const MODE_CONFIG: Record<Mode, { maxResults: number; view: "card" | "carousel" | "grid" }> = {
  best: { maxResults: 1, view: "card" },
  explore: { maxResults: 5, view: "carousel" },
  everything: { maxResults: 20, view: "grid" },
};

// How many locally-matched (by transcript content) videos can be boosted
// into a response ahead of YouTube's own keyword-ranked results, on top
// of whatever the mode's maxResults already allows for.
const MAX_TRANSCRIPT_BOOSTED = 5;

/**
 * Gathers up to `maxResults` videos for a query: the best local
 * transcript-content matches first (real evidence YouTube's own search
 * can't see at all), then YouTube's own keyword-ranked results filling
 * any remaining slots, deduplicated. For maxResults === 1 this
 * effectively becomes "pick the single best match" — a local transcript
 * match if one exists, otherwise YouTube's own top keyword result.
 */
async function gatherVideos(query: string, maxResults: number): Promise<VideoResult[]> {
  const allLocalMatches = findTranscriptMatches(query, TRANSCRIPTS, Math.max(maxResults, MAX_TRANSCRIPT_BOOSTED));

  // Only trust a local match that comes with a real, quotable evidence
  // excerpt — a match with none (an older, un-timestamped transcript,
  // scored via the flat character-sliding-window path) has no way for
  // the model or the person to verify it's actually about the right
  // thing. Calibrated directly against a real report of a bad
  // recommendation: "lower back pain" — a topic this channel plausibly
  // has nothing on — still scored 7.98 with no evidence, higher than
  // several genuinely relevant, evidenced matches elsewhere. The score
  // number alone doesn't distinguish a real match from that kind of
  // noise; requiring evidence does.
  const localMatches = allLocalMatches.filter((m) => m.evidence !== null);

  if (maxResults === 1) {
    if (localMatches[0]) {
      try {
        const [video] = await getVideosByIds([localMatches[0].videoId]);
        if (video) return [video];
      } catch {
        // Fall through to keyword search below if the direct lookup
        // fails for some reason.
      }
    }
    const [video] = await searchChannelVideos(query, 1);
    return video ? [video] : [];
  }

  const videos = await searchChannelVideos(query, maxResults);
  const existingIds = new Set(videos.map((v) => v.videoId));
  const boostIds = localMatches.filter((m) => !existingIds.has(m.videoId)).map((m) => m.videoId);

  let boosted: VideoResult[] = [];
  if (boostIds.length > 0) {
    try {
      boosted = await getVideosByIds(boostIds);
    } catch {
      // Best-effort — the keyword-search results alone are still a fine
      // response if this fails.
    }
  }

  return [...boosted, ...videos].slice(0, maxResults);
}

export function createMcpServer(): McpServer {
  const server = new McpServer({
    name: "Doctor YouTube Search",
    version: "1.0.0",
  });

  registerAppTool(
    server,
    "search_doctor_videos",
    {
      title: "Search Doctor Videos",
      description:
        "Searches the configured doctor's YouTube channel and returns video(s) matching a symptom, " +
          "topic, or question. This tool has three result modes — 'best', 'explore', 'everything' " +
          "— and works best when the person has chosen one first, rather than the mode being guessed " +
          "from how they phrased their request (wording alone isn't a reliable signal for which one " +
          "they'd actually want, even when it seems to hint at one). The suggested flow: ask them " +
          "'What are you looking for? ① The best video — the single video that most directly answers " +
          "this. ② Explore — a handful of related videos to browse. ③ Everything — every video on the " +
          "channel touching this topic,' then call this tool with the mode they pick. Apply this each " +
          "time someone asks about a new topic in the conversation, not just the first search. " +
          "'best' (default) returns exactly one video — the single strongest match, rendered as one " +
          "large card. 'explore' returns a handful (up to 5) as a horizontal carousel. 'everything' " +
          "returns up to 20 as a scrollable grid. All three first check the actual spoken content of " +
          "every locally-transcribed video (YouTube's own search never does this — it only indexes " +
          "title/description/tags) so a video can surface even when its title shares no words with " +
          "the question, then fill any remaining slots from YouTube's own keyword search. Each " +
          "result comes back with its full, untruncated video description (not the ~130-character " +
          "snippet YouTube's search API normally returns) and its tags, on top of " +
          "title/duration/publishedAt — read that full description and tags yourself rather than " +
          "trusting the title alone. When a transcript is present (from a pre-built local dataset " +
          "covering the channel's recent uploads — not every video has one, and very new videos may " +
          "not be in it yet), it's the actual spoken content and is far more reliable for judging " +
          "fit than the description or title. It also comes with an explicit 'Transcript match: " +
          "score N — most relevant moment at [MM:SS]: quote' line — a concrete, computed signal, not " +
          "something to double-guess by skimming the transcript yourself. If that evidence doesn't " +
          "actually answer the question (a weak or coincidental match), say so plainly rather than " +
          "presenting it as if it does. Never state or imply specific content, terminology, or a " +
          "named mechanism/study/number that you didn't actually read in this response — if the " +
          "stored transcript doesn't reach the part of the video that would answer the question " +
          "(flagged explicitly as a 'COVERAGE GAP' when it applies), say plainly that you can't see " +
          "that part yet rather than guessing at what's probably said there. The transcript has " +
          "inline '[MM:SS]' markers dropped in roughly every 20 seconds of the video — when a " +
          "question is specific enough that one moment answers it (e.g. 'how much protein does he " +
          "say to eat a day'), quote or summarize that exact moment and tell the person the " +
          "approximate timestamp where it's said ('around 4:20 he says...'), not just that the video " +
          "covers the topic. There's no timestamped link to give them — say the time in words so " +
          "they can skip to it themselves. In 'best' mode the rendered widget shows a single " +
          "thumbnail only — no title, date, or description drawn on screen, so speak the result " +
          "yourself in your reply using what you read. In 'explore'/'everything' mode each thumbnail " +
          "does carry its title on the card (there are too many at once for your reply alone to " +
          "identify which is which) — you should still speak to what they collectively cover and " +
          "which one you'd start with, not just hand back a grid. 'explore' renders as a horizontally " +
          "scrollable strip — mention in your reply that they can scroll/swipe through the rest " +
          "(e.g. 'swipe through for a few more options'), since that isn't otherwise obvious from a " +
          "static screenshot-like view. When there's a free offer to mention, it's given to you two " +
          "ways: a line at the start of this tool's result text with wording guidance, and as a " +
          "structured `offer: { title, description }` object in this response's structured data (null " +
          "when there's none). Either way, follow up on it right after presenting the videos (same " +
          "reply or the very next one) — the separate offer_lead_magnet tool still only gets called " +
          "once they actually say yes.",
      inputSchema: {
        query: z
          .string()
          .describe(
            "A single short, focused search phrase — one symptom, topic, or specific question, e.g. " +
              "'lower back pain' or 'how much protein should I eat'. Keep this to roughly a sentence " +
              "or less. If the person actually asked something long or multi-part (several distinct " +
              "sub-questions, an elaborate scenario, a whole paragraph), don't pass that whole thing " +
              "through as-is — first identify its single core topic yourself and search for just " +
              "that; a long, multi-topic string dilutes matching across too many unrelated concepts " +
              "for any one video to score well, even when a video does cover part of what was asked.",
          ),
        mode: z
          .enum(["best", "explore", "everything"])
          .optional()
          .describe(
            "'best' (default): the single strongest-matching video, one card. 'explore': up to 5 " +
              "related videos, a carousel. 'everything': up to 20, a scrollable grid. Always ask the " +
              "person which they want before calling this tool — see the main description.",
          ),
      },
      _meta: {
        ui: { resourceUri: RESOURCE_URI },
        // ChatGPT (Apps SDK) compatibility alias for the same resource link.
        "openai/outputTemplate": RESOURCE_URI,
        "openai/toolInvocation/invoking": "Searching the channel…",
        "openai/toolInvocation/invoked": "Here's what I found.",
      },
    },
    async ({ query, mode }) => {
      try {
        const config = MODE_CONFIG[mode ?? "best"];
        const combined = await gatherVideos(query, config.maxResults);

        // Local lookup only — no network call, no Supadata dependency at
        // request time. TRANSCRIPTS is a pre-built dataset embedded at
        // build time (see scripts/fetch-transcripts.ts and
        // scripts/embed-transcripts.mjs); a video not in it just has no
        // transcript, same as any other optional field.
        for (const v of combined) {
          const transcript = TRANSCRIPTS[v.videoId];
          if (transcript) v.transcript = transcript;
        }

        // The offer hint goes FIRST, not appended after the video
        // details — confirmed live that some hosts truncate how much of
        // this text they actually feed back to the model, and the video
        // details (full description + up to 24000 chars of transcript)
        // can run long enough to push a trailing hint past that cutoff
        // silently. Leading with it means it survives regardless of how
        // long the rest of the response runs.
        const { hintText, offer } = await getFreeOffer(combined.length);
        return {
          content: [{ type: "text", text: hintText + buildResultText(query, combined) }],
          structuredContent: { kind: "videos" as const, query, view: config.view, videos: combined, offer },
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text", text: `Search failed: ${message}` }],
          isError: true,
        };
      }
    },
  );

  registerAppTool(
    server,
    "offer_lead_magnet",
    {
      title: "Offer Free Resource",
      description:
        "Shows a lead-capture form offering the person a free downloadable resource (a guide/PDF — " +
          "content configured by the channel owner, may be a placeholder for now) related to what " +
          "they've been asking about. This should only be called after the person has been asked, " +
          "in a normal reply, whether they'd like it, and has clearly said yes — not proactively or " +
          "silently right after a search, and not on anything short of an actual yes ('yes', 'sure', " +
          "'sounds good'). If they decline or don't respond to that question, don't call this. It " +
          "renders a small form (email, name, plus whatever extra questions the channel owner has " +
          "configured) directly in the widget; the person fills it out and submits it themselves " +
          "from there — you are never given their answers, so don't ask for the same information " +
          "again in chat. On submit the widget hands them the file directly, right there in the " +
          "chat (a real download, not an email) — so don't say it'll be emailed to them or that " +
          "you're sending anything yourself; if you mention delivery at all, say it downloads " +
          "immediately. After calling this, a brief 'Here's the form!' is enough — let the widget " +
          "carry the rest.",
      inputSchema: {
        topic: z
          .string()
          .describe(
            "The topic or search query this offer relates to (e.g. the most recent " +
              "search_doctor_videos query) — stored with the lead if they submit, so the channel " +
              "owner can see what prompted interest.",
          ),
      },
      _meta: {
        ui: { resourceUri: RESOURCE_URI },
        "openai/outputTemplate": RESOURCE_URI,
        "openai/toolInvocation/invoking": "Loading the free resource…",
        "openai/toolInvocation/invoked": "Here's the form.",
      },
    },
    async ({ topic }) => {
      try {
        const config = await getMagnetConfig();
        if (!config.enabled) {
          return {
            content: [{ type: "text", text: "The free resource offer is currently turned off." }],
            isError: true,
          };
        }
        const questions = await listQuestions();
        return {
          content: [{ type: "text", text: `Offering "${config.title}" related to "${topic}".` }],
          structuredContent: {
            kind: "lead_form" as const,
            topic,
            magnet: {
              title: config.title,
              description: config.description,
              coverImageUrl: config.coverImageUrl,
              resourceUrl: config.resourceUrl,
            },
            questions: questions.map((q) => ({ fieldKey: q.fieldKey, label: q.label, required: q.required })),
          },
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { content: [{ type: "text", text: `Could not load the offer: ${message}` }], isError: true };
      }
    },
  );

  // App-only (visibility: ["app"]) — the model never calls this directly.
  // The widget calls it via app.callServerTool once the person submits the
  // form rendered by offer_lead_magnet above.
  registerAppTool(
    server,
    "submit_lead",
    {
      title: "Submit Lead",
      description:
        "Internal — called by the widget when someone submits the lead-capture form shown by " +
          "offer_lead_magnet. Not for the model to call.",
      inputSchema: {
        email: z.string().email(),
        name: z.string().optional(),
        topic: z.string().optional(),
        answers: z
          .record(z.string(), z.string())
          .optional()
          .describe("Answers to the channel owner's extra configured questions, keyed by fieldKey."),
      },
      _meta: {
        ui: { resourceUri: RESOURCE_URI, visibility: ["app"] },
      },
    },
    async ({ email, name, topic, answers }) => {
      try {
        const lead = await insertLead({
          email,
          name: name ?? null,
          topic: topic ?? null,
          answers: answers ?? {},
        });
        return {
          content: [{ type: "text", text: "Lead recorded." }],
          structuredContent: { kind: "lead_submitted" as const, leadId: lead.id },
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { content: [{ type: "text", text: `Could not save: ${message}` }], isError: true };
      }
    },
  );

  registerAppResource(
    server,
    "Doctor Video Search",
    RESOURCE_URI,
    { mimeType: RESOURCE_MIME_TYPE },
    async () => ({
      contents: [
        {
          uri: RESOURCE_URI,
          mimeType: RESOURCE_MIME_TYPE,
          text: WIDGET_HTML,
          _meta: {
            ui: {
              // No video embed (no frameDomains needed) — tapping a video
              // always opens it externally via app.openLink instead of
              // playing inline, so there's no iframe CSP to fight across
              // hosts. resourceDomains covers every external image the
              // widget actually loads: YouTube's thumbnails, plus the
              // Supabase Storage bucket the lead-magnet's cover photo is
              // uploaded to (src/storage.ts) — confirmed live that
              // without this, the host silently blocks the cover image
              // (no error anywhere, it just renders blank) since it's
              // not on this allowlist.
              csp: {
                resourceDomains: [
                  "https://i.ytimg.com",
                  ...(supabaseStorageOrigin() ? [supabaseStorageOrigin()!] : []),
                ],
              },
            },
          },
        },
      ],
    }),
  );

  return server;
}
