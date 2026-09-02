// src/match.ts
// Keyword matching between a person's question and the creator's product
// catalog. Adapted from the transcript search this app used to run over
// YouTube captions — the scoring model carried over intact, because the
// problem is the same shape (score short free-text documents against a
// natural-language question) and it was already generic over any
// Record<id, text> corpus. What did not carry over is the timestamped
// [MM:SS] evidence extraction: that existed to cite the moment in a video
// where an answer was spoken, and this app no longer answers with clips.
//
// Scoring is TF-IDF-style, not flat keyword coverage: a term that appears
// across most of the catalog ("kitchen", "daily", the creator's own brand
// name) is weak evidence for any one product, while a rare term ("knife",
// "creatine") is strong evidence for whichever product actually has it.
// IDF is computed live against the catalog itself — a catalog is a few
// dozen to a few hundred short documents, small enough to just scan.

const STOPWORDS = new Set([
  "a", "an", "the", "is", "are", "was", "were", "do", "does", "did", "of",
  "in", "on", "to", "for", "and", "or", "what", "how", "much", "many",
  "should", "would", "could", "i", "you", "he", "she", "it", "they", "we",
  "this", "that", "with", "about", "can", "need", "my", "your", "his",
  "her", "not", "just", "recommend", "recommends", "use", "uses", "using",
  "get", "got", "buy", "best", "good", "any", "one", "which", "who",
  // Goal-question scaffolding. These carry no product signal, but they are
  // most of what a goal-shaped question is made of ("I'm TRYING to GET INTO
  // cooking MORE"), and every one of them left in the query inflates the
  // coverage denominator — which is what decides whether an answer is
  // presented confidently or hedged as a steer. Leaving them in made a good
  // goal match score "weak" and apologise for itself.
  "trying", "try", "into", "more", "want", "wants", "wanting", "start",
  "starting", "started", "looking", "look", "need", "needs", "help",
  "something", "anything", "stuff", "thing", "things", "would",
]);

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/['’]/g, "")
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 2 && !STOPWORDS.has(word));
}

// A term's contribution is idf * log-damped term frequency, not idf * raw
// count — a product whose blurb happens to repeat a generic word many
// times shouldn't out-rank the product that names the actually rare,
// specific word once or twice.
function termWeight(idfValue: number, occurrences: number): number {
  return occurrences > 0 ? idfValue * (1 + Math.log(occurrences)) : 0;
}

// IDF against the catalog itself. A term in every product scores near 1x;
// a term in only one or two scores several times higher.
function buildIdf(queryTerms: string[], corpus: Record<string, string>): Map<string, number> {
  const docs = Object.values(corpus).map((d) => d.toLowerCase());
  const idf = new Map<string, number>();
  for (const term of queryTerms) {
    const docFrequency = docs.filter((doc) => doc.includes(term)).length;
    idf.set(term, Math.log((docs.length + 1) / (docFrequency + 1)) + 1);
  }
  return idf;
}

function weighAgainst(
  text: string,
  queryTerms: string[],
  idf: Map<string, number>,
): { score: number; matchedIdf: number } {
  const lower = text.toLowerCase();
  let score = 0;
  let matchedIdf = 0;
  for (const term of queryTerms) {
    const occurrences = lower.split(term).length - 1;
    if (occurrences > 0) {
      score += termWeight(idf.get(term)!, occurrences);
      matchedIdf += idf.get(term)!;
    }
  }
  return { score, matchedIdf };
}

export interface Match {
  id: string;
  /** Raw TF-IDF weight — comparable between products, meaningless alone. */
  score: number;
  /**
   * Share of the question's total IDF mass this product actually matched,
   * 0..1. Unlike `score` this IS meaningful on its own, which is what makes
   * it usable as a confidence threshold (see MATCH_STRONG in mcp-server.ts):
   * matching the one rare, load-bearing word in a question counts for far
   * more here than matching two throwaway ones.
   */
  coverage: number;
}

/**
 * Scores every document in the corpus against the question's keywords and
 * returns the ones with a nonzero score, best first. Returns an empty array
 * when the question has no usable terms or nothing matched at all — callers
 * are expected to handle that as "no pick for this", not as an error.
 */
export function findMatches(
  question: string,
  corpus: Record<string, string>,
  topN = 3,
): Match[] {
  const queryTerms = [...new Set(tokenize(question))];
  if (queryTerms.length === 0) return [];

  const idf = buildIdf(queryTerms, corpus);
  const totalIdf = queryTerms.reduce((sum, term) => sum + idf.get(term)!, 0);
  if (totalIdf === 0) return [];

  const scored: Match[] = [];
  for (const [id, text] of Object.entries(corpus)) {
    const { score, matchedIdf } = weighAgainst(text, queryTerms, idf);
    if (score > 0) scored.push({ id, score, coverage: matchedIdf / totalIdf });
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, topN);
}
