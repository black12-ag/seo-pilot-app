import { ProjectContextRepository } from "@/server/features/project-context/repositories/ProjectContextRepository";
import { KeywordClusterRepository } from "@/server/features/keywords/repositories/KeywordClusterRepository";
import {
  clusterKeywords,
  isSimilarEnough,
  keywordTerms,
  normalizeKeywordText,
} from "@/shared/keywordClusters";

/** Keeps grouping fast on the request path. The UI says when it applies. */
const MAX_CLUSTERED_KEYWORDS = 1000;

type Market = { locationCode: number; languageCode: string };

function samePlace(a: Market, b: Market) {
  return a.locationCode === b.locationCode && a.languageCode === b.languageCode;
}

function decodedPath(url: string) {
  try {
    return decodeURIComponent(new URL(url).pathname);
  } catch {
    return "";
  }
}

async function getClusters(input: {
  projectId: string;
  projectMarket: Market;
  requestedMarket?: Market;
}) {
  const { projectId, projectMarket, requestedMarket } = input;
  const markets =
    await KeywordClusterRepository.listSavedKeywordMarkets(projectId);
  const findMarket = (wanted: Market | undefined) =>
    wanted && markets.find((market) => samePlace(market, wanted));
  const chosen =
    findMarket(requestedMarket) ?? findMarket(projectMarket) ?? markets[0];
  const market: Market = chosen
    ? { locationCode: chosen.locationCode, languageCode: chosen.languageCode }
    : projectMarket;
  const base = {
    markets,
    market,
    isProjectMarket: samePlace(market, projectMarket),
    totalKeywords: chosen?.keywordCount ?? 0,
    clusteredKeywords: 0,
  };
  if (!chosen) return { ...base, clusters: [] };

  const [saved, tracked, keyPages] = await Promise.all([
    KeywordClusterRepository.listSavedKeywordsWithMetrics({
      projectId,
      ...market,
      limit: MAX_CLUSTERED_KEYWORDS,
    }),
    KeywordClusterRepository.listTrackedKeywords({ projectId, ...market }),
    ProjectContextRepository.listKeyPages(projectId),
  ]);

  const { languageCode } = market;
  const trackedExact = new Set(tracked.map(normalizeKeywordText));
  const trackedTerms = tracked.map((keyword) => ({
    keyword,
    terms: keywordTerms(keyword, languageCode),
  }));
  const pageTerms = keyPages.map((page) => ({
    page: { url: page.url, role: page.role, topic: page.topic },
    terms: keywordTerms(
      `${decodedPath(page.url).replace(/[/_.-]+/g, " ")} ${page.topic ?? ""}`,
      languageCode,
    ),
  }));

  const groups = clusterKeywords(
    saved.map((row) => ({
      keyword: row.keyword,
      searchVolume: row.searchVolume ?? null,
      intent: row.intent ?? null,
      tracked: trackedExact.has(normalizeKeywordText(row.keyword)),
    })),
    languageCode,
  );

  return {
    ...base,
    clusteredKeywords: saved.length,
    clusters: groups.map((group) => ({
      id: group.id,
      label: group.label,
      keywords: group.keywords,
      trackedKeywords: trackedTerms
        .filter(({ terms }) => isSimilarEnough(terms, group.terms))
        .map(({ keyword }) => keyword),
      pages: pageTerms
        .filter(
          ({ terms }) =>
            group.terms.length > 0 &&
            (isSimilarEnough(terms, group.terms) ||
              group.terms.every((term) => terms.includes(term))),
        )
        .map(({ page }) => page),
    })),
  };
}

export const KeywordClusterService = { getClusters } as const;
