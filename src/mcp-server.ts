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
        "Searches the configured doctor's YouTube channel for the ONE video that best matches a " +
          "symptom, topic, or question, and returns exactly that one video — no options, no list to " +
          "sort through. First it checks the actual spoken content of every locally-transcribed " +
          "video (YouTube's own search never does this — it only indexes title/description/tags), " +
          "and picks whichever video has the strongest real evidence for the question; only when no " +
          "video's transcript has a meaningful match does it fall back to YouTube's own keyword " +
          "search. The result comes back with its full, untruncated video description (not the " +
          "~130-character snippet YouTube's search API normally returns) and its tags, on top of " +
          "title/duration/publishedAt — read that full description and tags yourself rather than " +
          "trusting the title alone, since a video can be exactly right without sharing any of the " +
          "question's words. When a transcript is present (from a pre-built local dataset covering " +
          "the channel's recent uploads — not every video has one, and very new videos may not be " +
          "in it yet), it's the actual spoken content and is far more reliable for judging fit than " +
          "the description or title. It also comes with an explicit 'Transcript match: score N — " +
          "most relevant moment at [MM:SS]: quote' line — that's a concrete, computed signal, not " +
          "something to double-guess by skimming the transcript yourself. If that evidence doesn't " +
          "actually answer the question (a weak or coincidental match), say so plainly rather than " +
          "presenting it as if it does. The transcript has inline '[MM:SS]' markers dropped in " +
          "roughly every 20 seconds of the video — when a question is specific enough that one " +
          "moment answers it (e.g. 'how much protein does he say to eat a day'), quote or summarize " +
          "that exact moment and tell the person the approximate timestamp where it's said ('around " +
          "4:20 he says...'), not just that the video covers the topic. There's no timestamped link " +
          "to give them — say the time in words so they can skip to it themselves. The rendered " +
          "widget shows a single thumbnail only — no title, date, or description drawn on screen. " +
          "So after calling this, speak the result yourself in your reply using what you read: say " +
          "what it covers and why it fits, quoting the transcript evidence when it's specific enough " +
          "to. Don't just confirm a video was found — the thumbnail carries no information on its " +
          "own without your reply.",
      inputSchema: {
        query: z
          .string()
          .describe("Symptom, topic, or question to search the channel for, e.g. 'lower back pain'."),
      },
      _meta: {
        ui: { resourceUri: RESOURCE_URI },
        // ChatGPT (Apps SDK) compatibility alias for the same resource link.
        "openai/outputTemplate": RESOURCE_URI,
        "openai/toolInvocation/invoking": "Searching the channel…",
        "openai/toolInvocation/invoked": "Here's what I found.",
      },
    },
    async ({ query }) => {
      try {
        // Always exactly one video, always a single card — no carousel,
        // spotlight, or grid for now (see git history for that logic if
        // it needs to come back). Prefer the best local transcript match
        // (real content evidence, not just title/tag keyword overlap);
        // fall back to YouTube's own keyword search only when no video's
        // transcript has any match at all.
        const [topMatch] = findTranscriptMatches(query, TRANSCRIPTS, 1);

        let video: VideoResult | undefined;
        if (topMatch) {
          try {
            [video] = await getVideosByIds([topMatch.videoId]);
          } catch {
            // Fall through to keyword search below if the direct lookup
            // fails for some reason.
          }
        }
        if (!video) {
          [video] = await searchChannelVideos(query, 1);
        }

        const combined = video ? [video] : [];

        // Local lookup only — no network call, no Supadata dependency at
        // request time. TRANSCRIPTS is a pre-built dataset embedded at
        // build time (see scripts/fetch-transcripts.ts and
        // scripts/embed-transcripts.mjs); a video not in it just has no
        // transcript, same as any other optional field.
        for (const v of combined) {
          const transcript = TRANSCRIPTS[v.videoId];
          if (transcript) v.transcript = transcript;
        }

        return {
          content: [{ type: "text", text: buildResultText(query, combined) }],
          structuredContent: { query, view: "card" as const, videos: combined },
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
              // hosts. resourceDomains covers the YouTube thumbnail images.
              csp: {
                resourceDomains: ["https://i.ytimg.com"],
              },
            },
          },
        },
      ],
    }),
  );

  return server;
}
