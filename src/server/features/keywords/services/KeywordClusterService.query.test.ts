import { reverse } from "remeda";
import { afterAll, beforeEach, expect, it, vi } from "vitest";

const { testDb } = await vi.hoisted(async () => {
  const { createSiteAuthorityTestDb } =
    await import("../../site-authority/siteAuthorityTestDb");
  return { testDb: await createSiteAuthorityTestDb() };
});

vi.mock("cloudflare:workers", () => ({
  env: { DATABASE_PROVIDER: testDb.provider },
}));
vi.mock("@/db", () => ({ db: testDb.db }));
vi.mock("@/db/runBatch", () => ({ runBatch: testDb.runBatch }));

import { summarizeCluster } from "@/shared/keywordClusters";
import { KeywordClusterService } from "./KeywordClusterService";

const US = { locationCode: 2840, languageCode: "en" };
const UK = { locationCode: 2826, languageCode: "en" };

let nextId = 0;
async function saveKeyword(
  keyword: string,
  metric: { volume?: number | null; intent?: string | null } = {},
  market = US,
  projectId = "project",
) {
  nextId += 1;
  await testDb.execute(
    `insert into saved_keywords (id, project_id, keyword, location_code, language_code)
     values ('sk-${nextId}', '${projectId}', '${keyword}', ${market.locationCode}, '${market.languageCode}')`,
  );
  if (metric.volume === undefined && metric.intent === undefined) return;
  await testDb.execute(
    `insert into keyword_metrics (project_id, keyword, location_code, language_code, search_volume, intent)
     values ('${projectId}', '${keyword}', ${market.locationCode}, '${market.languageCode}',
       ${metric.volume ?? "null"}, ${metric.intent ? `'${metric.intent}'` : "null"})`,
  );
}

async function trackKeyword(
  keyword: string,
  { market = US, active = true, projectId = "project" } = {},
) {
  nextId += 1;
  await testDb.execute(
    `insert into rank_tracking_configs (id, project_id, domain, location_code, language_code, serp_depth, is_active)
     values ('cfg-${nextId}', '${projectId}', 'site-${nextId}.com', ${market.locationCode}, '${market.languageCode}', 100, ${testDb.provider === "postgres" ? String(active) : active ? 1 : 0})`,
  );
  await testDb.execute(
    `insert into rank_tracking_keywords (id, config_id, keyword)
     values ('rk-${nextId}', 'cfg-${nextId}', '${keyword}')`,
  );
}

async function savePage(
  url: string,
  topic: string | null,
  projectId = "project",
) {
  nextId += 1;
  await testDb.execute(
    `insert into project_key_pages (id, project_id, url, role, topic, updated_by)
     values ('page-${nextId}', '${projectId}', '${url}', 'money', ${topic ? `'${topic}'` : "null"}, 'user')`,
  );
}

function clusters(requestedMarket?: typeof US) {
  return KeywordClusterService.getClusters({
    projectId: "project",
    projectMarket: US,
    requestedMarket,
  });
}

function shape(result: Awaited<ReturnType<typeof clusters>>) {
  return result.clusters.map((cluster) => ({
    label: cluster.label,
    keywords: cluster.keywords.map((row) => row.keyword),
  }));
}

beforeEach(async () => {
  await testDb.seedProject();
  await testDb.executeMultiple(
    `delete from saved_keywords; delete from keyword_metrics; delete from rank_tracking_configs; delete from project_key_pages;`,
  );
});
afterAll(testDb.close);

it("groups keywords by shared terms the same way whatever the saved order", async () => {
  const keywords = [
    "running shoes",
    "best running shoes",
    "running shoe",
    "how to bake bread",
    "bread baking",
    "garden tools",
  ];
  for (const keyword of keywords) await saveKeyword(keyword);
  const first = await clusters();

  await testDb.executeMultiple(`delete from saved_keywords;`);
  for (const keyword of reverse(keywords)) await saveKeyword(keyword);
  const second = await clusters();

  expect(shape(second)).toEqual(shape(first));
  expect(shape(first)).toEqual(
    expect.arrayContaining([
      {
        label: "running shoe",
        keywords: ["best running shoes", "running shoe", "running shoes"],
      },
      { label: "garden tools", keywords: ["garden tools"] },
    ]),
  );
});

it("keeps unknown metrics unknown instead of counting them as zero", async () => {
  await saveKeyword("seo tools", { volume: 1000, intent: "commercial" });
  await saveKeyword("seo tools free", { volume: null, intent: "unknown" });
  await saveKeyword("garden gnome");
  await saveKeyword("free stuff", { volume: 0 });

  const { clusters: groups } = await clusters();
  const seo = groups.find((cluster) => cluster.label === "seo tools");
  const gnome = groups.find((cluster) => cluster.label === "garden gnome");
  const free = groups.find((cluster) => cluster.label === "free stuff");

  expect(seo?.keywords.map((row) => row.searchVolume)).toEqual([1000, null]);
  expect(summarizeCluster(seo?.keywords ?? [])).toEqual({
    keywordCount: 2,
    totalVolume: 1000,
    volumeKnownCount: 1,
    intent: "commercial",
    intentKeywordCount: 1,
  });
  expect(summarizeCluster(gnome?.keywords ?? [])).toMatchObject({
    totalVolume: null,
    volumeKnownCount: 0,
    intent: null,
  });
  // A known zero is a real number.
  expect(summarizeCluster(free?.keywords ?? [])).toMatchObject({
    totalVolume: 0,
    volumeKnownCount: 1,
  });
});

it("recomputes totals from the keywords left after a removal", async () => {
  await saveKeyword("seo tools", { volume: 1000, intent: "commercial" });
  await saveKeyword("seo tools free", { volume: 400, intent: "informational" });
  const { clusters: groups } = await clusters();
  const remaining = (groups[0]?.keywords ?? []).filter(
    (row) => row.keyword !== "seo tools",
  );
  expect(summarizeCluster(remaining)).toMatchObject({
    keywordCount: 1,
    totalVolume: 400,
    intent: "informational",
  });
});

it("keeps markets apart and reports the market used", async () => {
  await saveKeyword("seo tools", { volume: 1000 });
  await saveKeyword("seo tools", { volume: 50 }, UK);
  await saveKeyword("seo audit tools", {}, UK);
  await trackKeyword("seo tools", { market: UK });

  const us = await clusters();
  expect(us.market).toEqual(US);
  expect(us.isProjectMarket).toBe(true);
  expect(us.markets).toHaveLength(2);
  expect(us.clusters[0]?.keywords).toEqual([
    {
      keyword: "seo tools",
      searchVolume: 1000,
      intent: null,
      tracked: false,
    },
  ]);
  expect(us.clusters[0]?.trackedKeywords).toEqual([]);

  const uk = await clusters(UK);
  expect(uk.market).toEqual(UK);
  expect(uk.isProjectMarket).toBe(false);
  expect(uk.clusters[0]?.keywords.map((row) => row.tracked)).toEqual([
    true,
    false,
  ]);
  expect(uk.clusters[0]?.trackedKeywords).toEqual(["seo tools"]);
});

it("falls back to a saved market when the project's has no keywords", async () => {
  await saveKeyword("seo tools", {}, UK);
  const result = await clusters();
  expect(result.market).toEqual(UK);
  expect(result.isProjectMarket).toBe(false);
  expect(result.clusters).toHaveLength(1);
});

it("shows only tracked keywords and saved pages that cover a group", async () => {
  await saveKeyword("running shoes");
  await saveKeyword("garden tools");
  await trackKeyword("best running shoes");
  await trackKeyword("trail maps");
  await trackKeyword("garden tools", { active: false });
  await savePage("https://example.com/guides/running-shoes", null);
  await savePage("https://example.com/about", "Who we are");
  await savePage("not a url", "Garden tools");

  const { clusters: groups } = await clusters();
  const shoes = groups.find((cluster) => cluster.label === "running shoes");
  const garden = groups.find((cluster) => cluster.label === "garden tools");

  expect(shoes?.trackedKeywords).toEqual(["best running shoes"]);
  expect(shoes?.pages.map((page) => page.url)).toEqual([
    "https://example.com/guides/running-shoes",
  ]);
  // A paused tracker does not count as coverage.
  expect(garden?.trackedKeywords).toEqual([]);
  expect(garden?.keywords[0]?.tracked).toBe(false);
  expect(garden?.pages.map((page) => page.topic)).toEqual(["Garden tools"]);
});

it("never reads another project's keywords, trackers or pages", async () => {
  await saveKeyword("seo tools", { volume: 10 }, US, "foreign-project");
  await trackKeyword("seo tools", { projectId: "foreign-project" });
  await savePage("https://other.com/seo-tools", "SEO tools", "foreign-project");
  await saveKeyword("seo tools");

  const result = await clusters();
  expect(result.totalKeywords).toBe(1);
  expect(result.clusters[0]).toMatchObject({
    keywords: [{ searchVolume: null, tracked: false }],
    trackedKeywords: [],
    pages: [],
  });
});

it("returns an empty result when nothing is saved", async () => {
  await expect(clusters()).resolves.toMatchObject({
    market: US,
    isProjectMarket: true,
    totalKeywords: 0,
    clusters: [],
    markets: [],
  });
});
