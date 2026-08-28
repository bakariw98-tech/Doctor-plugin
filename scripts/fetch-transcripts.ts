// scripts/fetch-transcripts.ts
// Offline data-collection step: pulls transcripts for the channel's videos
// via Supadata and writes them to data/transcripts.json.
//
// This is NOT part of the deployed server. The running app never calls
// Supadata — it only reads the dataset this script produces (embedded at
// build time by scripts/embed-transcripts.mjs into
// src/generated/transcripts.ts). Supadata is used to build our own data,
// once, offline; it isn't a live feature or dependency of the app that
// ships for review.
//
// Run:
//   npm run fetch-transcripts             # up to 100 videos (default)
//   npm run fetch-transcripts -- 30       # up to 30 videos
//
// Requires YOUTUBE_API_KEY, one of YOUTUBE_CHANNEL_ID/YOUTUBE_CHANNEL_HANDLE,
// and SUPADATA_API_KEY in .env (the npm script loads it via Node's
// --env-file).
//
// Idempotent: videos already present in data/transcripts.json are skipped
// on a re-run — including ones confirmed to have no transcript — so
// running this again later (e.g. after the channel publishes new videos)
// only spends credits on videos it hasn't seen before. Delete an entry
// from the JSON file (or pass --force) to re-check a specific video.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { listChannelVideos } from "../src/youtube.js";
import { fetchTranscript } from "../src/transcript.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_PATH = path.join(__dirname, "..", "data", "transcripts.json");

interface TranscriptEntry {
  title: string;
  transcript: string | null;
  fetchedAt: string;
}

function loadExisting(): Record<string, TranscriptEntry> {
  try {
    return JSON.parse(fs.readFileSync(DATA_PATH, "utf-8")) as Record<string, TranscriptEntry>;
  } catch {
    return {};
  }
}

function save(data: Record<string, TranscriptEntry>) {
  fs.mkdirSync(path.dirname(DATA_PATH), { recursive: true });
  fs.writeFileSync(DATA_PATH, `${JSON.stringify(data, null, 2)}\n`);
}

async function main() {
  const args = process.argv.slice(2);
  const force = args.includes("--force");
  const limitArg = args.find((a) => /^\d+$/.test(a));
  const limit = limitArg ? Number(limitArg) : 100;

  const supadataKey = process.env.SUPADATA_API_KEY?.trim();
  if (!supadataKey) {
    console.error("Set SUPADATA_API_KEY in .env before running this script.");
    console.error("Get one at https://dash.supadata.ai/organizations/api-key");
    process.exit(1);
  }

  console.log(`Listing up to ${limit} videos from the channel's uploads...`);
  const videos = await listChannelVideos(limit);
  console.log(`Found ${videos.length} videos.`);

  const existing = loadExisting();
  const toFetch = force ? videos : videos.filter((v) => !(v.videoId in existing));
  const alreadyOnFile = videos.length - toFetch.length;
  console.log(
    `${toFetch.length} to fetch, ${alreadyOnFile} already on file` +
      (force ? " (--force: re-checking everything anyway)." : "."),
  );

  let fetchedCount = 0;
  let noneCount = 0;

  for (const [i, video] of toFetch.entries()) {
    const label = `[${i + 1}/${toFetch.length}] ${video.title.slice(0, 55)}`;
    process.stdout.write(`${label.padEnd(65)} `);

    const transcript = await fetchTranscript(video.url, supadataKey);
    existing[video.videoId] = {
      title: video.title,
      transcript,
      fetchedAt: new Date().toISOString(),
    };

    if (transcript) {
      fetchedCount++;
      console.log(`✓ ${transcript.length} chars`);
    } else {
      noneCount++;
      console.log("— none available");
    }

    // Save after every video, not just at the end — a crash or Ctrl-C
    // partway through still keeps whatever was fetched so far, and a
    // re-run picks up exactly where this one stopped.
    save(existing);
  }

  const totalOnFile = Object.keys(existing).length;
  console.log(
    `\nDone. ${fetchedCount} transcript${fetchedCount === 1 ? "" : "s"} fetched this run, ` +
      `${noneCount} video${noneCount === 1 ? "" : "s"} confirmed to have none, ` +
      `${totalOnFile} total on file.`,
  );
  console.log(`Wrote ${path.relative(process.cwd(), DATA_PATH)}`);
  console.log(`Next: npm run build (embeds it), then commit data/transcripts.json and redeploy.`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
