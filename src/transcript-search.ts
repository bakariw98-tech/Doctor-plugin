// src/transcript-search.ts
// Simple local search over the pre-built transcript dataset
// (src/generated/transcripts.ts). YouTube's search.list only indexes a
// video's title/description/tags — never what's actually said in it — so
// a question phrased naturally ("how much protein should I eat") can
// entirely miss the one video that answers it in speech, even when that
// video's transcript covers it in detail. This gives the transcript text
// itself a chance to surface the video, on top of (not instead of)
// YouTube's own keyword-ranked results.
//
// Scoring is TF-IDF-style, not flat keyword coverage: a query term that
// shows up in nearly every video on this channel ("fat", "carnivore",
// "protein") is weak evidence for any one of them, while a term that
// shows up in only one or two ("butter") is strong evidence for whichever
// video actually has it. Found live: a broad query like "butter, animal
// fat, saturated fat" was scoring a video that repeats "fat" and
// "saturated" many times above the one video that specifically says
// "butter" — equal per-term weighting rewards generic repetition over the
// one word that actually answers the question. Weighting rare terms more
// heavily fixes that without needing real semantic search.

const STOPWORDS = new Set([
  "a", "an", "the", "is", "are", "was", "were", "do", "does", "did", "of",
  "in", "on", "to", "for", "and", "or", "what", "how", "much", "many",
  "should", "would", "could", "i", "you", "he", "she", "it", "they", "we",
  "this", "that", "with", "about", "can", "need", "my", "your", "his",
  "her", "not", "just", "say", "says", "said", "specifically", "general",
  "generally",
]);

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/['’]/g, "")
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 2 && !STOPWORDS.has(word));
}

export interface Evidence {
  timestamp: string;
  quote: string;
}

interface Chunk {
  timestamp: string;
  text: string;
}

// Splits a transcript's inline "[MM:SS] ..." markers back into
// (timestamp, text-until-next-marker) pairs, so a match can be pinned to
// the specific moment it came from rather than just "somewhere in this
// transcript."
function splitIntoChunks(transcript: string): Chunk[] {
  const parts = transcript.split(/(?=\[\d+(?::\d{2}){1,2}\])/g);
  const chunks: Chunk[] = [];
  for (const part of parts) {
    const match = part.match(/^\[(\d+(?::\d{2}){1,2})\]\s*([\s\S]*)$/);
    if (match) chunks.push({ timestamp: match[1], text: match[2].trim() });
  }
  return chunks;
}

const EVIDENCE_QUOTE_LIMIT = 240;

// A term's contribution is idf * log-damped term frequency, not idf * raw
// count — a channel that says "fat" fifteen times in one video shouldn't
// out-rank a video that says "butter" (the actually rare, specific word)
// only twice just from sheer repetition of a generic term. 1 + log(n)
// keeps repetition worth something without letting it dominate.
function termWeight(idfValue: number, occurrences: number): number {
  return occurrences > 0 ? idfValue * (1 + Math.log(occurrences)) : 0;
}

// A winning window can run long before it ever reaches the word that
// actually earned it the win — a chunk boundary lands wherever it lands,
// not conveniently right before the key term. So the quote is centered on
// the most distinctive (highest-idf) matched term's first occurrence,
// with ellipses marking what got trimmed on either side, instead of
// always taking the window's first EVIDENCE_QUOTE_LIMIT characters and
// risking the actual match never appearing in what's shown.
function buildQuote(text: string, queryTerms: string[], idf: Map<string, number>): string {
  if (text.length <= EVIDENCE_QUOTE_LIMIT) return text;

  const lower = text.toLowerCase();
  let anchorTerm: string | null = null;
  let anchorIdf = -Infinity;
  for (const term of queryTerms) {
    if (lower.includes(term) && idf.get(term)! > anchorIdf) {
      anchorTerm = term;
      anchorIdf = idf.get(term)!;
    }
  }
  const anchorIndex = anchorTerm ? lower.indexOf(anchorTerm) : 0;

  const half = Math.floor(EVIDENCE_QUOTE_LIMIT / 2);
  let start = Math.max(0, anchorIndex - half);
  let end = Math.min(text.length, start + EVIDENCE_QUOTE_LIMIT);
  start = Math.max(0, end - EVIDENCE_QUOTE_LIMIT);

  const prefix = start > 0 ? "…" : "";
  const suffix = end < text.length ? "…" : "";
  return `${prefix}${text.slice(start, end).trim()}${suffix}`;
}

function scoreAndExtractEvidence(
  transcript: string,
  queryTerms: string[],
  idf: Map<string, number>,
): { score: number; evidence: Evidence | null } {
  const lowerFull = transcript.toLowerCase();
  let score = 0;
  for (const term of queryTerms) {
    const occurrences = lowerFull.split(term).length - 1;
    score += termWeight(idf.get(term)!, occurrences);
  }
  if (score === 0) return { score: 0, evidence: null };

  // Evidence: the best-scoring 2-chunk sliding window, not a single raw
  // [MM:SS] chunk. Supadata's segment boundaries land wherever the
  // caption track happens to break, not at sentence edges — a chunk can
  // end "...animal fat and even" with the next one picking up "butter are
  // not entirely saturated fat," splitting credit for the very word that
  // matters across two chunks and burying the actual quote behind
  // whichever half scores higher alone. Pairing each chunk with the next
  // one before scoring keeps a straddling sentence intact.
  const chunks = splitIntoChunks(transcript);
  let best: { text: string; timestamp: string; weight: number } | null = null;
  for (let i = 0; i < chunks.length; i++) {
    const windowText = chunks[i + 1] ? `${chunks[i].text} ${chunks[i + 1].text}` : chunks[i].text;
    const lower = windowText.toLowerCase();
    let weight = 0;
    for (const term of queryTerms) {
      const occurrences = lower.split(term).length - 1;
      weight += termWeight(idf.get(term)!, occurrences);
    }
    if (weight > 0 && (!best || weight > best.weight)) {
      best = { text: windowText, timestamp: chunks[i].timestamp, weight };
    }
  }

  const evidence: Evidence | null = best ? { timestamp: best.timestamp, quote: buildQuote(best.text, queryTerms, idf) } : null;

  return { score, evidence };
}

// Inverse document frequency, computed against the local transcript
// corpus itself (no external corpus needed — 82ish documents is small
// enough to just scan directly per request). A term in every transcript
// scores near 1x; a term in only one or two scores several times higher.
function buildIdf(queryTerms: string[], corpus: Record<string, string>): Map<string, number> {
  const docs = Object.values(corpus);
  const idf = new Map<string, number>();
  for (const term of queryTerms) {
    const docFrequency = docs.filter((doc) => doc.toLowerCase().includes(term)).length;
    idf.set(term, Math.log((docs.length + 1) / (docFrequency + 1)) + 1);
  }
  return idf;
}

export interface TranscriptMatch {
  videoId: string;
  score: number;
  evidence: Evidence | null;
}

/**
 * Scores every transcript in the local dataset against the query's
 * keywords (TF-IDF-weighted, not flat coverage — see file header) and
 * returns the top `topN` with a nonzero score, each with its best
 * supporting [MM:SS] quote attached.
 */
export function findTranscriptMatches(
  query: string,
  transcripts: Record<string, string>,
  topN = 3,
): TranscriptMatch[] {
  const queryTerms = [...new Set(tokenize(query))];
  if (queryTerms.length === 0) return [];

  const idf = buildIdf(queryTerms, transcripts);
  const scored: TranscriptMatch[] = [];
  for (const [videoId, transcript] of Object.entries(transcripts)) {
    const { score, evidence } = scoreAndExtractEvidence(transcript, queryTerms, idf);
    if (score > 0) scored.push({ videoId, score, evidence });
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, topN);
}

/**
 * Same scoring as findTranscriptMatches, for one already-known transcript
 * rather than searching the whole corpus — used to attach a match score
 * and evidence quote to every video already in a response (including ones
 * that came from YouTube's keyword search, not the local match pass), so
 * the model gets an explicit number and quote instead of having to judge
 * relevance itself by reading the whole transcript.
 */
export function scoreTranscript(
  query: string,
  transcript: string,
  corpus: Record<string, string>,
): { score: number; evidence: Evidence | null } {
  const queryTerms = [...new Set(tokenize(query))];
  if (queryTerms.length === 0) return { score: 0, evidence: null };
  const idf = buildIdf(queryTerms, corpus);
  return scoreAndExtractEvidence(transcript, queryTerms, idf);
}
