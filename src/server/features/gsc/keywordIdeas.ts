import { sort } from "remeda";
import {
  resolveDateRange,
  type GscDateRange,
  type GscPerformanceFilter,
} from "@/server/features/gsc/searchAnalytics";
import { isStrikingDistancePosition } from "@/server/features/gsc/searchPerformanceReport";
import { GscService } from "@/server/features/gsc/services/GscService";

// Queries per call. Search Console sorts by clicks, so this keeps the top
// of the long tail; the per-page fan-out needs more rows to find each query's
// best page.
const QUERY_ROW_LIMIT = 1_000;
const QUERY_PAGE_ROW_LIMIT = 5_000;

export type GscKeywordIdea = {
  keyword: string;
  clicks: number;
  impressions: number;
  /** 0..1 */
  ctr: number;
  /** Average position over the period's impressions, one decimal. */
  position: number;
  /** The site's best-ranking page for the query, if Search Console had one. */
  page: string | null;
  /** Ranking 5-20: the queries where a better page most often pays off. */
  strikingDistance: boolean;
};

/**
 * Keyword ideas from the project's own Search Console property: the queries it
 * already gets impressions for. Free first-party data, so impressions are
 * impressions — not search volume — and only queries the site appeared for
 * show up.
 */
export async function getGscKeywordIdeas(input: {
  projectId: string;
  dateRange: GscDateRange;
  device?: string;
  country?: string;
}): Promise<{
  startDate: string;
  endDate: string;
  ideas: GscKeywordIdea[];
}> {
  const { startDate, endDate } = resolveDateRange({
    dateRange: input.dateRange,
  });
  const filters: GscPerformanceFilter[] = [];
  if (input.device)
    filters.push({
      dimension: "device",
      operator: "equals",
      expression: input.device,
    });
  if (input.country)
    filters.push({
      dimension: "country",
      operator: "equals",
      expression: input.country,
    });
  const [queries, queryPages] = await Promise.all([
    GscService.getPerformance({
      projectId: input.projectId,
      startDate,
      endDate,
      dimensions: ["query"],
      filters,
      rowLimit: QUERY_ROW_LIMIT,
    }),
    GscService.getPerformance({
      projectId: input.projectId,
      startDate,
      endDate,
      dimensions: ["query", "page"],
      filters,
      rowLimit: QUERY_PAGE_ROW_LIMIT,
    }),
  ]);

  const bestPage = new Map<string, { page: string; position: number }>();
  for (const row of queryPages.rows) {
    const [query, page] = row.keys ?? [];
    if (!query || !page) continue;
    const current = bestPage.get(query);
    if (!current || row.position < current.position) {
      bestPage.set(query, { page, position: row.position });
    }
  }

  const ideas: GscKeywordIdea[] = [];
  for (const row of queries.rows) {
    const keyword = row.keys?.[0];
    if (!keyword) continue;
    ideas.push({
      keyword,
      clicks: row.clicks,
      impressions: row.impressions,
      ctr: row.ctr,
      position: Math.round(row.position * 10) / 10,
      page: bestPage.get(keyword)?.page ?? null,
      strikingDistance: isStrikingDistancePosition(row.position),
    });
  }
  return {
    startDate,
    endDate,
    ideas: sort(ideas, (a, b) => b.impressions - a.impressions),
  };
}
