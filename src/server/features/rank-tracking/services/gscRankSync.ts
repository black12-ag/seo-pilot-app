import { sort } from "remeda";
import { GscConnectionRepository } from "@/server/features/gsc/repositories/GscConnectionRepository";
import { RankTrackingRepository } from "@/server/features/rank-tracking/repositories/RankTrackingRepository";
import { GscRankQueries } from "@/server/features/rank-tracking/repositories/gscRankQueries";
import { toRankTrackingTimestamp } from "@/server/features/rank-tracking/rankTrackingTimestamps";
import {
  createGscClient,
  type GscDimensionFilter,
  type GscSearchAnalyticsRequest,
} from "@/server/lib/gscClient";
import { GscNotConnectedError } from "@/server/lib/gscErrors";
import type { RankTrackingConfig } from "@/types/schemas/rank-tracking";

// How far back a new tracker (or a newly added keyword) is filled in.
export const GSC_RANK_BACKFILL_DAYS = 30;
// Google's own page cap for searchAnalytics.query.
const GSC_PAGE_SIZE = 25_000;
// A runaway guard: at most this many pages per keyword chunk.
const GSC_MAX_PAGES = 8;
// RE2 patterns are length-limited; keep each OR-list well under it.
const MAX_REGEX_LENGTH = 2_000;

type Device = "desktop" | "mobile";
type GscDayRow = {
  position: number;
  impressions: number;
  clicks: number;
};

const GSC_DEVICE: Record<Device, string> = {
  desktop: "DESKTOP",
  mobile: "MOBILE",
};

function utcDate(date: Date, daysBack: number): string {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() - daysBack);
  return d.toISOString().slice(0, 10);
}

function escapeRe2(value: string): string {
  return value.replace(/[\\^$.|?*+()[\]{}]/g, "\\$&");
}

/** Case-insensitive exact-match regexes for the keywords, in RE2-safe sizes. */
function keywordRegexChunks(keywords: string[]): string[] {
  const chunks: string[] = [];
  let current: string[] = [];
  let length = 0;
  for (const keyword of keywords) {
    const part = escapeRe2(keyword.toLowerCase());
    if (current.length > 0 && length + part.length + 1 > MAX_REGEX_LENGTH) {
      chunks.push(`(?i)^(?:${current.join("|")})$`);
      current = [];
      length = 0;
    }
    current.push(part);
    length += part.length + 1;
  }
  if (current.length > 0) chunks.push(`(?i)^(?:${current.join("|")})$`);
  return chunks;
}

function configDevices(devices: RankTrackingConfig["devices"]): Device[] {
  return devices === "both" ? ["desktop", "mobile"] : [devices];
}

/** One decimal, the precision Search Console itself shows. */
export function roundGscPosition(position: number): number {
  return Math.round(position * 10) / 10;
}

/**
 * Fill a Search Console tracker's daily history: every day Google has final
 * data for, from GSC_RANK_BACKFILL_DAYS ago to yesterday, gets one completed
 * run, and each tracked keyword/device one snapshot in it. A keyword with no
 * row that day had no impressions, so its position is stored as null.
 *
 * Only missing days and keywords are fetched, so the daily call costs one
 * small `date` query plus the new day. Positions are Google's average over
 * the day's impressions, never mixed with DataForSEO rows (source = "gsc").
 */
async function syncGscRankHistory(
  config: Pick<
    RankTrackingConfig,
    "id" | "projectId" | "devices" | "gscCountry" | "source"
  >,
  today: Date = new Date(),
): Promise<{ daysAdded: number; snapshotsAdded: number }> {
  if (config.source !== "gsc") {
    throw new Error("Not a Search Console tracker");
  }
  const connection = await GscConnectionRepository.getByProjectId(
    config.projectId,
  );
  if (!connection) throw new GscNotConnectedError(config.projectId);
  const keywords = await RankTrackingRepository.getKeywordsForConfig(config.id);
  if (keywords.length === 0) return { daysAdded: 0, snapshotsAdded: 0 };

  const client = createGscClient({
    userId: connection.connectedByUserId,
    gscAccountId: connection.gscAccountId ?? undefined,
  });
  const startDate = utcDate(today, GSC_RANK_BACKFILL_DAYS);
  const endDate = utcDate(today, 1);
  const devices = configDevices(config.devices);
  const filters: GscDimensionFilter[] = [];
  if (config.gscCountry) {
    filters.push({
      dimension: "country",
      operator: "equals",
      expression: config.gscCountry,
    });
  }
  if (devices.length === 1) {
    filters.push({
      dimension: "device",
      operator: "equals",
      expression: GSC_DEVICE[devices[0]],
    });
  }
  const baseRequest: GscSearchAnalyticsRequest = {
    startDate,
    endDate,
    type: "web",
    // Final data only: fresh days still change, and a stored day must not.
    dataState: "final",
  };

  // Days Google has final data for, for the whole property.
  const dayRows = await client.querySearchAnalytics(connection.siteUrl, {
    ...baseRequest,
    dimensions: ["date"],
    rowLimit: GSC_RANK_BACKFILL_DAYS + 5,
    ...(filters.length > 0 && {
      dimensionFilterGroups: [{ groupType: "and", filters }],
    }),
  });
  const availableDays = sort(
    dayRows
      .map((row) => row.keys?.[0])
      .filter((day): day is string => !!day && day >= startDate),
    (a, b) => a.localeCompare(b),
  );

  const coverage = await GscRankQueries.getGscRunCoverage(config.id, startDate);
  const neededDays = availableDays.filter((day) => {
    const stored = coverage.get(day);
    return !stored || keywords.some((kw) => !stored.keywordIds.has(kw.id));
  });
  if (neededDays.length === 0) return { daysAdded: 0, snapshotsAdded: 0 };

  // day → lowercased query → device → row
  const rowsByDay = new Map<string, Map<string, Map<Device, GscDayRow>>>();
  for (const expression of keywordRegexChunks(
    keywords.map((kw) => kw.keyword),
  )) {
    for (let page = 0; page < GSC_MAX_PAGES; page++) {
      const rows = await client.querySearchAnalytics(connection.siteUrl, {
        ...baseRequest,
        startDate: neededDays[0],
        endDate: neededDays[neededDays.length - 1],
        dimensions: ["date", "query", "device"],
        rowLimit: GSC_PAGE_SIZE,
        startRow: page * GSC_PAGE_SIZE,
        dimensionFilterGroups: [
          {
            groupType: "and",
            filters: [
              ...filters,
              { dimension: "query", operator: "includingRegex", expression },
            ],
          },
        ],
      });
      for (const row of rows) {
        const [day, query, device] = row.keys ?? [];
        const deviceKey = device?.toLowerCase();
        if (
          !day ||
          !query ||
          (deviceKey !== "desktop" && deviceKey !== "mobile")
        )
          continue;
        const byQuery =
          rowsByDay.get(day) ?? new Map<string, Map<Device, GscDayRow>>();
        rowsByDay.set(day, byQuery);
        const byDevice =
          byQuery.get(query.toLowerCase()) ?? new Map<Device, GscDayRow>();
        byQuery.set(query.toLowerCase(), byDevice);
        byDevice.set(deviceKey, {
          position: row.position,
          impressions: row.impressions,
          clicks: row.clicks,
        });
      }
      if (rows.length < GSC_PAGE_SIZE) break;
    }
  }

  const completedAt = toRankTrackingTimestamp(today);
  let daysAdded = 0;
  let snapshotsAdded = 0;
  for (const day of neededDays) {
    const stored = coverage.get(day);
    const dayStamp = toRankTrackingTimestamp(new Date(`${day}T00:00:00Z`));
    const runId =
      stored?.runId ??
      (await GscRankQueries.ensureGscRun({
        configId: config.id,
        projectId: config.projectId,
        dataDate: day,
        startedAt: dayStamp,
        completedAt,
      }));
    if (!stored) daysAdded++;
    const missing = keywords.filter((kw) => !stored?.keywordIds.has(kw.id));
    const snapshots = missing.flatMap((kw) =>
      devices.map((device) => {
        const row = rowsByDay
          .get(day)
          ?.get(kw.keyword.toLowerCase())
          ?.get(device);
        return {
          runId,
          trackingKeywordId: kw.id,
          keyword: kw.keyword,
          device,
          source: "gsc" as const,
          position: row ? Math.round(row.position) : null,
          averagePosition: row ? roundGscPosition(row.position) : null,
          impressions: row?.impressions ?? null,
          clicks: row?.clicks ?? null,
          checkedAt: dayStamp,
        };
      }),
    );
    await GscRankQueries.insertGscSnapshots(snapshots);
    snapshotsAdded += snapshots.length;
    await GscRankQueries.setRunKeywordCount(
      runId,
      (stored?.keywordIds.size ?? 0) + missing.length,
    );
  }
  return { daysAdded, snapshotsAdded };
}

/**
 * Sync a Search Console tracker and stamp it checked. Free, so no billing or
 * workflow: it runs inline for "Refresh", after adding keywords, and from the
 * scheduler. Returns the newest stored day's run.
 */
export async function refreshGscTracker(
  config: Parameters<typeof syncGscRankHistory>[0],
  today: Date = new Date(),
) {
  const result = await syncGscRankHistory(config, today);
  await RankTrackingRepository.updateConfig(config.id, config.projectId, {
    lastCheckedAt: toRankTrackingTimestamp(today),
    lastSkipReason: null,
  });
  const latest = await RankTrackingRepository.getLatestRunForConfig(config.id);
  return { ...result, runId: latest?.id ?? null };
}
