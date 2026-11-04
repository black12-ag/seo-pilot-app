import { sort } from "remeda";

/**
 * Keyword grouping with no external calls, so the same input always gives the
 * same groups.
 *
 * 1. A keyword becomes a set of terms: lowercased, punctuation removed. For
 *    English markets, common words are dropped and plurals are reduced.
 * 2. Keywords are visited shortest first, then by volume, then alphabetically.
 * 3. A keyword joins the group whose lead keyword it is most similar to, when
 *    similarity is at least 0.5. Otherwise it starts a new group.
 *
 * Similarity is the Jaccard index: shared terms divided by all distinct terms
 * across both keywords. Comparing with the lead only keeps groups from drifting
 * through a chain of loosely related keywords.
 */
const SIMILARITY_THRESHOLD = 0.5;

const ENGLISH_STOPWORDS = new Set(
  "a an and are as at be by can do does for from how i in is it my of on or that the this to vs was what when where which who why will with you your".split(
    " ",
  ),
);

export type ClusterKeyword = {
  keyword: string;
  searchVolume: number | null;
  intent: string | null;
  tracked: boolean;
};

type KeywordGroup = {
  id: string;
  label: string;
  terms: string[];
  keywords: ClusterKeyword[];
};

function reducePlural(term: string) {
  if (term.length > 4 && term.endsWith("ies")) return `${term.slice(0, -3)}y`;
  if (term.length > 3 && term.endsWith("s") && !/(ss|us|is)$/.test(term)) {
    return term.slice(0, -1);
  }
  return term;
}

export function normalizeKeywordText(keyword: string) {
  return keyword.normalize("NFKC").toLowerCase().trim().replace(/\s+/g, " ");
}

function sortedDistinct(terms: readonly string[]) {
  return sort([...new Set(terms)], compareText);
}

/** The sorted, distinct terms of a keyword or other short text. */
export function keywordTerms(text: string, languageCode: string): string[] {
  const words =
    normalizeKeywordText(text).match(/[\p{L}\p{M}\p{N}]+/gu) ??
    ([] as string[]);
  const isEnglish = languageCode.toLowerCase().startsWith("en");
  if (!isEnglish) return sortedDistinct(words);
  const kept = words.filter((word) => !ENGLISH_STOPWORDS.has(word));
  // A keyword made only of common words keeps them, so it can still be matched.
  return sortedDistinct((kept.length > 0 ? kept : words).map(reducePlural));
}

function termSimilarity(a: readonly string[], b: readonly string[]) {
  if (a.length === 0 || b.length === 0) return 0;
  const other = new Set(b);
  const shared = a.filter((term) => other.has(term)).length;
  return shared / (a.length + b.length - shared);
}

export function isSimilarEnough(a: readonly string[], b: readonly string[]) {
  return termSimilarity(a, b) >= SIMILARITY_THRESHOLD;
}

function compareText(a: string, b: string) {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

function compareByVolumeThenKeyword(a: ClusterKeyword, b: ClusterKeyword) {
  return (
    (b.searchVolume ?? -1) - (a.searchVolume ?? -1) ||
    compareText(a.keyword, b.keyword)
  );
}

export function clusterKeywords(
  rows: readonly ClusterKeyword[],
  languageCode: string,
): KeywordGroup[] {
  const visits = sort(
    rows.map((row) => ({
      row,
      terms: keywordTerms(row.keyword, languageCode),
    })),
    (a, b) =>
      a.terms.length - b.terms.length ||
      compareByVolumeThenKeyword(a.row, b.row),
  );

  const groups: KeywordGroup[] = [];
  for (const { row, terms } of visits) {
    let best: KeywordGroup | null = null;
    let bestScore = 0;
    for (const group of groups) {
      const score = termSimilarity(terms, group.terms);
      if (score >= SIMILARITY_THRESHOLD && score > bestScore) {
        best = group;
        bestScore = score;
      }
    }
    if (best) {
      best.keywords.push(row);
    } else {
      groups.push({
        id: normalizeKeywordText(row.keyword),
        label: row.keyword,
        terms,
        keywords: [row],
      });
    }
  }

  return sort(
    groups.map((group) => ({
      ...group,
      keywords: sort(group.keywords, compareByVolumeThenKeyword),
      volume: summarizeCluster(group.keywords).totalVolume ?? -1,
    })),
    (a, b) => b.volume - a.volume || compareText(a.id, b.id),
  ).map(({ volume: _volume, ...group }) => group);
}

/**
 * Totals for the keywords still in a group. Unknown values stay unknown: a
 * total only counts known volumes, and is null when none are known.
 */
export function summarizeCluster(keywords: readonly ClusterKeyword[]) {
  const volumes = keywords.flatMap((row) =>
    row.searchVolume == null ? [] : [row.searchVolume],
  );
  const intentCounts = new Map<string, number>();
  for (const { intent } of keywords) {
    if (intent && intent !== "unknown") {
      intentCounts.set(intent, (intentCounts.get(intent) ?? 0) + 1);
    }
  }
  const [topIntent] = sort(
    [...intentCounts],
    (a, b) => b[1] - a[1] || compareText(a[0], b[0]),
  );
  return {
    keywordCount: keywords.length,
    totalVolume:
      volumes.length > 0
        ? volumes.reduce((total, volume) => total + volume, 0)
        : null,
    volumeKnownCount: volumes.length,
    intent: topIntent?.[0] ?? null,
    intentKeywordCount: topIntent?.[1] ?? 0,
  };
}
