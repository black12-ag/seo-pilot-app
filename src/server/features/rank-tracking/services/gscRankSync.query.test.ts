import { createClient, type Client } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import type {
  GscSearchAnalyticsRequest,
  GscSearchAnalyticsRow,
} from "@/server/lib/gscClient";
import type * as GscRankSyncModule from "./gscRankSync";

// Real in-memory SQLite, so the per-day runs, the (config, day) and
// (run, keyword, device) conflict targets and the coverage reads run as SQL.
// Only Google and the connection lookup are faked.

vi.mock("cloudflare:workers", () => ({
  env: { DATABASE_PROVIDER: "d1" },
}));

const mocks = vi.hoisted(() => ({
  query:
    vi.fn<
      (
        siteUrl: string,
        request: GscSearchAnalyticsRequest,
      ) => Promise<GscSearchAnalyticsRow[]>
    >(),
  getConnection: vi.fn(),
}));

vi.mock("@/server/lib/gscClient", () => ({
  createGscClient: () => ({ querySearchAnalytics: mocks.query }),
}));
vi.mock("@/server/features/gsc/repositories/GscConnectionRepository", () => ({
  GscConnectionRepository: { getByProjectId: mocks.getConnection },
}));

let client: Client;
let refreshGscTracker: typeof GscRankSyncModule.refreshGscTracker;

beforeAll(async () => {
  client = createClient({ url: "file::memory:" });
  const testDb = drizzle(client);
  vi.doMock("@/db", () => ({ db: testDb }));
  vi.doMock("@/db/runBatch", () => ({
    DB_BATCH_SIZE: 100,
    executeInBatches: async <T>(
      items: T[],
      build: (tx: typeof testDb, item: T) => Promise<unknown>,
    ) => {
      for (const item of items) await build(testDb, item);
    },
  }));
  await client.executeMultiple(`
    CREATE TABLE rank_tracking_configs (
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL, domain TEXT NOT NULL,
      location_code INTEGER NOT NULL DEFAULT 2840,
      language_code TEXT NOT NULL DEFAULT 'en',
      devices TEXT NOT NULL DEFAULT 'both', serp_depth INTEGER NOT NULL,
      schedule_interval TEXT NOT NULL DEFAULT 'daily', location_name TEXT,
      is_active INTEGER NOT NULL DEFAULT 1, last_checked_at TEXT,
      next_check_at TEXT, last_skip_reason TEXT,
      source TEXT NOT NULL DEFAULT 'dataforseo',
      gsc_country TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE rank_tracking_keywords (
      id TEXT PRIMARY KEY, config_id TEXT NOT NULL, keyword TEXT NOT NULL,
      match_case INTEGER NOT NULL DEFAULT 0, search_volume INTEGER,
      keyword_difficulty INTEGER, cpc REAL, metrics_fetched_at TEXT,
      pinned_at TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE rank_check_runs (
      id TEXT PRIMARY KEY, config_id TEXT NOT NULL, project_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      keywords_total INTEGER NOT NULL DEFAULT 0,
      keywords_checked INTEGER NOT NULL DEFAULT 0,
      is_subset_run INTEGER NOT NULL DEFAULT 0, error_message TEXT,
      started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, completed_at TEXT,
      data_date TEXT
    );
    CREATE UNIQUE INDEX rank_check_runs_config_data_date_idx
      ON rank_check_runs (config_id, data_date);
    CREATE TABLE rank_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT, run_id TEXT NOT NULL,
      tracking_keyword_id TEXT NOT NULL, keyword TEXT NOT NULL,
      device TEXT NOT NULL, position INTEGER, url TEXT, serp_features TEXT,
      checked_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      source TEXT NOT NULL DEFAULT 'dataforseo', average_position REAL,
      impressions INTEGER, clicks INTEGER
    );
    CREATE UNIQUE INDEX rank_snapshots_run_keyword_device_idx
      ON rank_snapshots (run_id, tracking_keyword_id, device);
  `);
  ({ refreshGscTracker } = await import("./gscRankSync"));
});

afterAll(() => {
  client.close();
});

const TODAY = new Date("2026-11-09T08:00:00Z");
const config = {
  id: "cfg",
  projectId: "proj",
  devices: "both" as const,
  gscCountry: "usa",
  source: "gsc" as const,
};

beforeEach(async () => {
  await client.executeMultiple(`
    DELETE FROM rank_snapshots; DELETE FROM rank_check_runs;
    DELETE FROM rank_tracking_keywords; DELETE FROM rank_tracking_configs;
    INSERT INTO rank_tracking_configs (id, project_id, domain, serp_depth, source, gsc_country)
      VALUES ('cfg', 'proj', 'example.com', 100, 'gsc', 'usa');
    INSERT INTO rank_tracking_keywords (id, config_id, keyword)
      VALUES ('kw1', 'cfg', 'blue shoes'), ('kw2', 'cfg', 'red shoes');
  `);
  mocks.getConnection.mockResolvedValue({
    siteUrl: "sc-domain:example.com",
    connectedByUserId: "user",
    gscAccountId: null,
  });
  // Final data for two days; "blue shoes" was shown on desktop both days.
  mocks.query.mockImplementation(
    (_site: string, request: GscSearchAnalyticsRequest) => {
      if (request.dimensions?.[0] === "date" && request.dimensions.length === 1)
        return Promise.resolve([
          {
            keys: ["2026-11-06"],
            clicks: 3,
            impressions: 40,
            ctr: 0,
            position: 9,
          },
          {
            keys: ["2026-11-07"],
            clicks: 4,
            impressions: 50,
            ctr: 0,
            position: 8,
          },
        ]);
      return Promise.resolve(
        ["2026-11-06", "2026-11-07"].map((day, i) => ({
          keys: [day, "Blue Shoes", "DESKTOP"],
          clicks: i,
          impressions: 10 + i,
          ctr: 0,
          position: 7.26 - i,
        })),
      );
    },
  );
});

async function snapshots() {
  const result = await client.execute(
    `SELECT r.data_date, s.tracking_keyword_id, s.device, s.position,
            s.average_position, s.impressions, s.source
       FROM rank_snapshots s JOIN rank_check_runs r ON r.id = s.run_id
      ORDER BY r.data_date, s.tracking_keyword_id, s.device`,
  );
  return result.rows.map((row) => ({ ...row }));
}

describe("refreshGscTracker", () => {
  it("stores one completed run per Search Console day, marked as gsc data", async () => {
    const result = await refreshGscTracker(config, TODAY);

    expect(result).toMatchObject({ daysAdded: 2, snapshotsAdded: 8 });
    const rows = await snapshots();
    expect(rows).toHaveLength(8);
    expect(rows.every((row) => row.source === "gsc")).toBe(true);
    // Shown: exact average to one decimal, rounded integer for the buckets.
    expect(rows[0]).toMatchObject({
      data_date: "2026-11-06",
      tracking_keyword_id: "kw1",
      device: "desktop",
      position: 7,
      average_position: 7.3,
      impressions: 10,
    });
    // Not shown that day: no impressions, so no position.
    expect(rows[1]).toMatchObject({ device: "mobile", position: null });
    expect(rows[2]).toMatchObject({
      tracking_keyword_id: "kw2",
      position: null,
    });
    const runs = await client.execute(
      "SELECT status, keywords_total, started_at FROM rank_check_runs ORDER BY data_date",
    );
    expect(runs.rows.map((row) => ({ ...row }))).toEqual([
      {
        status: "completed",
        keywords_total: 2,
        started_at: "2026-11-06 00:00:00",
      },
      {
        status: "completed",
        keywords_total: 2,
        started_at: "2026-11-07 00:00:00",
      },
    ]);
  });

  it("asks Google for final data, the country filter and exact keyword matches", async () => {
    await refreshGscTracker(config, TODAY);

    const keywordRequest = mocks.query.mock.calls
      .map((call) => call[1])
      .find((request) => request.dimensions?.length === 3);
    expect(keywordRequest).toMatchObject({
      startDate: "2026-11-06",
      endDate: "2026-11-07",
      dataState: "final",
      dimensions: ["date", "query", "device"],
    });
    expect(keywordRequest?.dimensionFilterGroups?.[0].filters).toEqual([
      { dimension: "country", operator: "equals", expression: "usa" },
      {
        dimension: "query",
        operator: "includingRegex",
        expression: "(?i)^(?:blue shoes|red shoes)$",
      },
    ]);
  });

  it("fetches only what is missing: nothing new, then a newly added keyword", async () => {
    await refreshGscTracker(config, TODAY);
    mocks.query.mockClear();

    const again = await refreshGscTracker(config, TODAY);
    expect(again).toMatchObject({ daysAdded: 0, snapshotsAdded: 0 });
    // Only the cheap list of days.
    expect(mocks.query).toHaveBeenCalledTimes(1);

    await client.execute(
      "INSERT INTO rank_tracking_keywords (id, config_id, keyword) VALUES ('kw3', 'cfg', 'green shoes')",
    );
    const backfill = await refreshGscTracker(config, TODAY);
    expect(backfill).toMatchObject({ daysAdded: 0, snapshotsAdded: 4 });
    const runs = await client.execute(
      "SELECT keywords_total FROM rank_check_runs",
    );
    expect(runs.rows.map((row) => row.keywords_total)).toEqual([3, 3]);
  });

  it("refuses when the project has no Search Console connection", async () => {
    mocks.getConnection.mockResolvedValue(null);
    await expect(refreshGscTracker(config, TODAY)).rejects.toThrow(
      "Search Console is not connected",
    );
  });
});
