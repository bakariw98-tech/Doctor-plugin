// src/transcript-search.ts
// Simple local keyword scoring over the pre-built transcript dataset
// (src/generated/transcripts.ts). YouTube's search.list only indexes a
// video's title/description/tags — never what's actually said in it — so
// a question phrased naturally ("how much protein should I eat") can
// entirely miss the one video that answers it in speech, even when that
// video's transcript covers it in detail. This gives the transcript text
// itself a chance to surface the video, on top of (not instead of)
// YouTube's own keyword-ranked results.

const STOPWORDS = new Set([
  "a", "an", "the", "is", "are", "was", "were", "do", "does", "did", "of",
  "in", "on", "to", "for", "and", "or", "what", "how", "much", "many",
  "should", "would", "could", "i", "you", "he", "she", "it", "they", "we",
  "this", "that", "with", "about", "can", "need", "my", "your", "his",
  "her", "not", "just", "does",
]);

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/['’]/g, "")
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 2 && !STOPWORDS.has(word));
}

export interface TranscriptMatch {
  videoId: string;
  score: number;
}

/**
 * Scores every transcript in the local dataset against the query's
 * keywords — coverage of distinct query terms first, raw occurrence count
 * only as a tiebreaker — and returns the top `topN` with a nonzero score.
 * Deliberately simple keyword matching, not real semantic search, but
 * it's matching against actual spoken content, which YouTube's search
 * never sees at all, so it catches videos search.list would otherwise
 * miss entirely.
 */
export function findTranscriptMatches(
  query: string,
  transcripts: Record<string, string>,
  topN = 3,
): TranscriptMatch[] {
  const queryTerms = [...new Set(tokenize(query))];
  if (queryTerms.length === 0) return [];

  const scored: TranscriptMatch[] = [];
  for (const [videoId, transcript] of Object.entries(transcripts)) {
    const lower = transcript.toLowerCase();
    let coverage = 0;
    let occurrences = 0;
    for (const term of queryTerms) {
      const count = lower.split(term).length - 1;
      if (count > 0) {
        coverage += 1;
        occurrences += count;
      }
    }
    if (coverage === 0) continue;
    // Coverage (how many distinct query terms it hits) matters far more
    // than raw occurrence count — a video that mentions every word in the
    // question once is a better match than one that repeats a single word
    // a dozen times.
    scored.push({ videoId, score: coverage * 1000 + occurrences });
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, topN);
}
