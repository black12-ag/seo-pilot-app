import { and, eq, gte, inArray, isNotNull } from "drizzle-orm";
import type { InferInsertModel } from "drizzle-orm";
import { db } from "@/db";
import { rankCheckRuns, rankSnapshots, rankTrackingConfigs } from "@/db/schema";
import { executeInBatches } from "@/db/runBatch";

type SnapshotInsert = InferInsertModel<typeof rankSnapshots>;

// D1 caps bound parameters near 100 per statement; a snapshot row binds up
// to 12 columns.
const SNAPSHOT_ROWS_PER_STATEMENT = 8;

/** The project's Search Console tracker for a domain and country filter. */
async function getGscConfig(
  projectId: string,
  domain: string,
  gscCountry: string,
) {
  const rows = await db
    .select()
    .from(rankTrackingConfigs)
    .where(
      and(
        eq(rankTrackingConfigs.projectId, projectId),
        eq(rankTrackingConfigs.domain, domain),
        eq(rankTrackingConfigs.gscCountry, gscCountry),
        eq(rankTrackingConfigs.source, "gsc"),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

/**
 * The Search Console days already stored for a config from `sinceDate` on,
 * with the keywords each day holds, so a sync only fetches what is missing.
 */
async function getGscRunCoverage(configId: string, sinceDate: string) {
  const runs = await db
    .select({ id: rankCheckRuns.id, dataDate: rankCheckRuns.dataDate })
    .from(rankCheckRuns)
    .where(
      and(
        eq(rankCheckRuns.configId, configId),
        isNotNull(rankCheckRuns.dataDate),
        gte(rankCheckRuns.dataDate, sinceDate),
      ),
    );
  const coverage = new Map<
    string,
    { runId: string; keywordIds: Set<string> }
  >();
  for (const run of runs) {
    if (run.dataDate)
      coverage.set(run.dataDate, { runId: run.id, keywordIds: new Set() });
  }
  if (runs.length === 0) return coverage;

  const covered = await db
    .selectDistinct({
      runId: rankSnapshots.runId,
      trackingKeywordId: rankSnapshots.trackingKeywordId,
    })
    .from(rankSnapshots)
    .where(
      inArray(
        rankSnapshots.runId,
        db
          .select({ id: rankCheckRuns.id })
          .from(rankCheckRuns)
          .where(
            and(
              eq(rankCheckRuns.configId, configId),
              gte(rankCheckRuns.dataDate, sinceDate),
            ),
          ),
      ),
    );
  const byRun = new Map([...coverage.values()].map((day) => [day.runId, day]));
  for (const row of covered) {
    byRun.get(row.runId)?.keywordIds.add(row.trackingKeywordId);
  }
  return coverage;
}

/**
 * A completed run for one Search Console day. The (config, data_date) unique
 * index makes a racing second sync a no-op; the existing run's id is returned.
 */
async function ensureGscRun(input: {
  configId: string;
  projectId: string;
  dataDate: string;
  startedAt: string;
  completedAt: string;
}) {
  await db
    .insert(rankCheckRuns)
    .values({
      id: crypto.randomUUID(),
      configId: input.configId,
      projectId: input.projectId,
      status: "completed",
      dataDate: input.dataDate,
      startedAt: input.startedAt,
      completedAt: input.completedAt,
    })
    .onConflictDoNothing({
      target: [rankCheckRuns.configId, rankCheckRuns.dataDate],
    });
  const rows = await db
    .select({ id: rankCheckRuns.id })
    .from(rankCheckRuns)
    .where(
      and(
        eq(rankCheckRuns.configId, input.configId),
        eq(rankCheckRuns.dataDate, input.dataDate),
      ),
    )
    .limit(1);
  const runId = rows[0]?.id;
  if (!runId) throw new Error("Search Console run was not saved");
  return runId;
}

/** Bulk insert, skipping a (run, keyword, device) already saved. */
async function insertGscSnapshots(snapshots: SnapshotInsert[]) {
  const chunks: SnapshotInsert[][] = [];
  for (let i = 0; i < snapshots.length; i += SNAPSHOT_ROWS_PER_STATEMENT) {
    chunks.push(snapshots.slice(i, i + SNAPSHOT_ROWS_PER_STATEMENT));
  }
  await executeInBatches(chunks, (tx, chunk) =>
    tx
      .insert(rankSnapshots)
      .values(chunk)
      .onConflictDoNothing({
        target: [
          rankSnapshots.runId,
          rankSnapshots.trackingKeywordId,
          rankSnapshots.device,
        ],
      }),
  );
}

/** Keyword counts follow the snapshots a day holds, for the trend buckets. */
async function setRunKeywordCount(runId: string, keywordCount: number) {
  await db
    .update(rankCheckRuns)
    .set({ keywordsTotal: keywordCount, keywordsChecked: keywordCount })
    .where(eq(rankCheckRuns.id, runId));
}

export const GscRankQueries = {
  getGscConfig,
  getGscRunCoverage,
  ensureGscRun,
  insertGscSnapshots,
  setRunKeywordCount,
};
