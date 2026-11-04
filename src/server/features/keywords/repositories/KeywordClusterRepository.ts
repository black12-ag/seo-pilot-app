import { and, asc, count, desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  keywordMetrics,
  rankTrackingConfigs,
  rankTrackingKeywords,
  savedKeywords,
} from "@/db/schema";

type Market = { locationCode: number; languageCode: string };

async function listSavedKeywordMarkets(projectId: string) {
  const keywordCount = count();
  return db
    .select({
      locationCode: savedKeywords.locationCode,
      languageCode: savedKeywords.languageCode,
      keywordCount,
    })
    .from(savedKeywords)
    .where(eq(savedKeywords.projectId, projectId))
    .groupBy(savedKeywords.locationCode, savedKeywords.languageCode)
    .orderBy(
      desc(keywordCount),
      asc(savedKeywords.locationCode),
      asc(savedKeywords.languageCode),
    );
}

/** Highest volume first, so a capped read keeps the keywords that matter most. */
async function listSavedKeywordsWithMetrics(
  params: Market & { projectId: string; limit: number },
) {
  return db
    .select({
      keyword: savedKeywords.keyword,
      searchVolume: keywordMetrics.searchVolume,
      intent: keywordMetrics.intent,
    })
    .from(savedKeywords)
    .leftJoin(
      keywordMetrics,
      and(
        eq(keywordMetrics.projectId, savedKeywords.projectId),
        eq(keywordMetrics.keyword, savedKeywords.keyword),
        eq(keywordMetrics.locationCode, savedKeywords.locationCode),
        eq(keywordMetrics.languageCode, savedKeywords.languageCode),
      ),
    )
    .where(
      and(
        eq(savedKeywords.projectId, params.projectId),
        eq(savedKeywords.locationCode, params.locationCode),
        eq(savedKeywords.languageCode, params.languageCode),
      ),
    )
    .orderBy(
      desc(sql`coalesce(${keywordMetrics.searchVolume}, -1)`),
      asc(savedKeywords.keyword),
    )
    .limit(params.limit);
}

/** Keywords an active tracker follows in this market. */
async function listTrackedKeywords(params: Market & { projectId: string }) {
  const rows = await db
    .selectDistinct({ keyword: rankTrackingKeywords.keyword })
    .from(rankTrackingKeywords)
    .innerJoin(
      rankTrackingConfigs,
      eq(rankTrackingKeywords.configId, rankTrackingConfigs.id),
    )
    .where(
      and(
        eq(rankTrackingConfigs.projectId, params.projectId),
        eq(rankTrackingConfigs.locationCode, params.locationCode),
        eq(rankTrackingConfigs.languageCode, params.languageCode),
        eq(rankTrackingConfigs.isActive, true),
      ),
    )
    .orderBy(asc(rankTrackingKeywords.keyword));
  return rows.map((row) => row.keyword);
}

export const KeywordClusterRepository = {
  listSavedKeywordMarkets,
  listSavedKeywordsWithMetrics,
  listTrackedKeywords,
} as const;
