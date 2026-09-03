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
  // Generic verbs that carry the question but not its subject. "What does
  // she TAKE for energy" is about energy; leaving "take" in let it match
  // "people who take it seriously" on a BBQ festival.
  "take", "takes", "taking", "put", "puts", "keep", "keeps", "make", "makes",
  "go", "goes", "going", "know", "think", "love", "loves", "stay", "stays",
  "staying",
]);

// Suffix stripping, applied to the question and the catalog alike. Without
// it the matcher is exact-word-only, and found live against a real catalog:
// "trying to get into grilling" missed a product literally named "Portable
// Infrared Grill", and "how do i stay hydrated while training" missed an
// electrolyte mix whose own blurb says "need real hydration" — because
// grilling !== grill and hydrated !== hydration. Goal-shaped questions are
// the ones this product exists to answer, and they are exactly the ones
// phrased in a different inflection from the catalog copy.
//
// Deliberately crude rather than a real Porter stemmer: the only thing that
// matters is that a word and its inflections collapse to the SAME token on
// both sides, not that the token is a real word ("hydrate" and "hydration"
// both landing on "hydrat" is a perfect result here). Kept conservative
// because over-stemming reintroduces the false-positive class this file
// already fought once — see countTerms below.
function stem(word: string): string {
  let w = word;
  // Plurals before verb endings: "seasonings" -> "seasoning" -> "season".
  if (w.length > 4 && w.endsWith("ies")) w = w.slice(0, -3) + "y";
  else if (w.length > 4 && w.endsWith("ves")) w = w.slice(0, -3) + "f";
  else if (w.length > 4 && w.endsWith("sses")) w = w.slice(0, -2);
  else if (w.length > 3 && w.endsWith("es") && !w.endsWith("ses")) w = w.slice(0, -2);
  else if (w.length > 3 && w.endsWith("s") && !w.endsWith("ss") && !w.endsWith("us")) w = w.slice(0, -1);

  if (w.length > 5 && w.endsWith("ing")) w = w.slice(0, -3);
  else if (w.length > 4 && w.endsWith("ed")) w = w.slice(0, -2);
  else if (w.length > 5 && w.endsWith("ion")) w = w.slice(0, -3);
  else if (w.length > 4 && w.endsWith("ly")) w = w.slice(0, -2);

  // "running" -> "runn" -> "run". Not for ll/ss/zz, which are real endings
  // ("grill" must stay "grill", or it collides with "grid"/"grim" stems).
  if (w.length > 3 && /([bcdfgmnpt])\1$/.test(w)) w = w.slice(0, -1);

  // Trailing "e" last, so "knives" -> "knif" and "knife" -> "knif" meet.
  if (w.length > 4 && w.endsWith("e")) w = w.slice(0, -1);

  return w;
}

function tokenize(text: string): string[] {
  const words = text
    .toLowerCase()
    .replace(/['’]/g, "")
    .split(/[^a-z0-9]+/)
    // Stopwords are listed in their natural form, so they have to be
    // removed before stemming mangles them.
    .filter((word) => word.length > 2 && !STOPWORDS.has(word));
  return words.map(stem);
}

// A term's contribution is idf * log-damped term frequency, not idf * raw
// count — a product whose blurb happens to repeat a generic word many
// times shouldn't out-rank the product that names the actually rare,
// specific word once or twice.
function termWeight(idfValue: number, occurrences: number): number {
  return occurrences > 0 ? idfValue * (1 + Math.log(occurrences)) : 0;
}

/**
 * A document reduced to stem -> occurrence count.
 *
 * This replaced a regex-per-term scan of the raw text. That scan could only
 * ever compare literal words, which is what made stemming impossible: a
 * stemmed query term ("grill") would no longer match the raw text it came
 * from ("grilling"). Counting stems on both sides is what lets the two meet.
 *
 * It also keeps the fix that scan was built for. Matching used to be naive
 * substring counting, which found "mic" inside "che-MIC-al filters" and
 * "take" inside "takes" — both scored high enough to be presented as real
 * recommendations. Tokens have edges, so that whole class is gone by
 * construction rather than by careful regex.
 */
type DocIndex = Map<string, number>;

function indexDocument(text: string): DocIndex {
  const counts: DocIndex = new Map();
  for (const term of tokenize(text)) {
    counts.set(term, (counts.get(term) ?? 0) + 1);
  }
  return counts;
}

// IDF against the catalog itself. A term in every product scores near 1x;
// a term in only one or two scores several times higher.
function buildIdf(queryTerms: string[], docs: DocIndex[]): Map<string, number> {
  const idf = new Map<string, number>();
  for (const term of queryTerms) {
    const docFrequency = docs.filter((doc) => doc.has(term)).length;
    idf.set(term, Math.log((docs.length + 1) / (docFrequency + 1)) + 1);
  }
  return idf;
}

function weighAgainst(
  doc: DocIndex,
  queryTerms: string[],
  idf: Map<string, number>,
): { score: number; matchedIdf: number } {
  let score = 0;
  let matchedIdf = 0;
  for (const term of queryTerms) {
    const occurrences = doc.get(term) ?? 0;
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

  const entries = Object.entries(corpus).map(([id, text]) => ({ id, doc: indexDocument(text) }));
  const idf = buildIdf(queryTerms, entries.map((e) => e.doc));
  const totalIdf = queryTerms.reduce((sum, term) => sum + idf.get(term)!, 0);
  if (totalIdf === 0) return [];

  const scored: Match[] = [];
  for (const { id, doc } of entries) {
    const { score, matchedIdf } = weighAgainst(doc, queryTerms, idf);
    if (score > 0) scored.push({ id, score, coverage: matchedIdf / totalIdf });
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, topN);
}
