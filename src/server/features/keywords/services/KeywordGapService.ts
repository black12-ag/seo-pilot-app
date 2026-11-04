import { waitUntil } from "cloudflare:workers";
import { sort } from "remeda";
import { z } from "zod";
import type { BillingCustomerContext } from "@/server/billing/subscription";
import { mapKeywordItem } from "@/server/features/domain/services/domainKeywordMapper";
import { ProjectContextRepository } from "@/server/features/project-context/repositories/ProjectContextRepository";
import { createDataforseoClient } from "@/server/lib/dataforseo";
import { dataforseoPricing } from "@/server/lib/dataforseo/pricing";
import { parseResearchTargetOrThrow } from "@/server/lib/domainUtils";
import { AppError } from "@/server/lib/errors";
import { hasDataforseoAccess } from "@/server/lib/provider-access";
import { buildCacheKey, getCached, setCached } from "@/server/lib/r2-cache";
import { isHostedServerAuthMode } from "@/server/lib/runtime-env";
import { creditsForProviderUsd } from "@/shared/billing";
import { resolveLabsMarket } from "@/shared/keyword-locations";
import { normalizeKeywordText } from "@/shared/keywordClusters";
import { parseResearchTarget } from "@/shared/researchScope";

/** Ranked keywords are refreshed every 12 hours, like domain overview data. */
const RANKED_KEYWORDS_TTL_SECONDS = 12 * 60 * 60;
const ROWS_PER_DOMAIN = 500;

type GapProject = {
  id: string;
  domain: string | null;
  locationCode: number;
  languageCode: string;
};
type Market = { locationCode: number; languageCode: string };

const rankedSnapshotSchema = z.object({
  domain: z.string(),
  fetchedAt: z.string(),
  totalCount: z.number().nullable(),
  rows: z.array(
    z.object({
      keyword: z.string(),
      position: z.number().nullable(),
      url: z.string().nullable(),
      searchVolume: z.number().nullable(),
      keywordDifficulty: z.number().nullable(),
    }),
  ),
});
type RankedSnapshot = z.infer<typeof rankedSnapshotSchema>;
type RankedRow = RankedSnapshot["rows"][number];

function projectTarget(domain: string | null) {
  if (!domain) return null;
  const parsed = parseResearchTarget(domain);
  return parsed.ok ? parsed.target.hostname : null;
}

async function getSetup(project: GapProject) {
  const market = resolveLabsMarket({}, project);
  const [providerConfigured, hosted, competitors] = await Promise.all([
    hasDataforseoAccess(),
    isHostedServerAuthMode(),
    ProjectContextRepository.listCompetitors(project.id),
  ]);
  const usdPerDomain = dataforseoPricing.domain.rankedKeywords({
    target: "",
    ...market,
    limit: ROWS_PER_DOMAIN,
  });
  return {
    providerConfigured,
    projectDomain: projectTarget(project.domain),
    market,
    isProjectMarket:
      market.locationCode === project.locationCode &&
      market.languageCode === project.languageCode,
    competitors: competitors.map(({ domain, name }) => ({ domain, name })),
    estimate: {
      hosted,
      rowsPerDomain: ROWS_PER_DOMAIN,
      // Provider cost is only shown where the install pays it directly.
      usdPerDomain: hosted ? null : usdPerDomain,
      creditsPerDomain: creditsForProviderUsd(usdPerDomain),
    },
  };
}

async function loadSnapshot(
  domain: string,
  market: Market,
  projectId: string,
  customer: BillingCustomerContext,
): Promise<RankedSnapshot> {
  const cacheKey = await buildCacheKey("keywords:gap-ranked", {
    organizationId: customer.organizationId,
    projectId,
    domain,
    locationCode: market.locationCode,
    languageCode: market.languageCode,
    limit: ROWS_PER_DOMAIN,
  });
  const cached = rankedSnapshotSchema.safeParse(await getCached(cacheKey));
  if (cached.success) return cached.data;

  const response = await createDataforseoClient(customer).domain.rankedKeywords(
    {
      target: domain,
      ...market,
      limit: ROWS_PER_DOMAIN,
      orderBy: ["ranked_serp_element.serp_item.etv,desc"],
      itemTypes: ["organic"],
    },
  );

  const snapshot: RankedSnapshot = {
    domain,
    fetchedAt: new Date().toISOString(),
    totalCount: response.totalCount,
    rows: response.items.flatMap((item) => {
      const row = mapKeywordItem(item);
      return row
        ? [
            {
              keyword: row.keyword,
              position: row.position,
              url: row.url,
              searchVolume: row.searchVolume,
              keywordDifficulty: row.keywordDifficulty,
            },
          ]
        : [];
    }),
  };
  // An empty answer is still a real answer, so it is kept and not paid twice.
  waitUntil(
    setCached(cacheKey, snapshot, RANKED_KEYWORDS_TTL_SECONDS).catch(
      (error) => {
        console.error("keywords.gap.cache-write failed:", error);
      },
    ),
  );
  return snapshot;
}

/** The best position per keyword: a keyword can appear once per ranking page. */
function byKeyword(rows: readonly RankedRow[]) {
  const map = new Map<string, RankedRow>();
  for (const row of rows) {
    const key = normalizeKeywordText(row.keyword);
    const existing = map.get(key);
    if (
      !existing ||
      (row.position != null &&
        (existing.position == null || row.position < existing.position))
    ) {
      map.set(key, row);
    }
  }
  return map;
}

function coverageOf(snapshot: RankedSnapshot) {
  const fetchedRows = snapshot.rows.length;
  return {
    domain: snapshot.domain,
    fetchedAt: snapshot.fetchedAt,
    fetchedRows,
    totalCount: snapshot.totalCount,
    // A known total decides. With none, a full page could have more behind it.
    complete:
      snapshot.totalCount != null
        ? snapshot.totalCount <= fetchedRows
        : fetchedRows < ROWS_PER_DOMAIN,
  };
}

function compareGapRows(
  a: { keyword: string; searchVolume: number | null },
  b: { keyword: string; searchVolume: number | null },
) {
  const byVolume = (b.searchVolume ?? -1) - (a.searchVolume ?? -1);
  if (byVolume !== 0) return byVolume;
  if (a.keyword === b.keyword) return 0;
  return a.keyword < b.keyword ? -1 : 1;
}

function compareSnapshots(
  project: RankedSnapshot,
  competitors: RankedSnapshot[],
) {
  const projectRows = byKeyword(project.rows);
  const competitorRows = competitors.map((snapshot) => ({
    domain: snapshot.domain,
    rows: byKeyword(snapshot.rows),
  }));
  const keys = new Set(competitorRows.flatMap(({ rows }) => [...rows.keys()]));

  const rows = [...keys].map((key) => {
    const projectRow = projectRows.get(key) ?? null;
    const cells = competitorRows.map(({ domain, rows: domainRows }) => {
      const row = domainRows.get(key);
      return {
        domain,
        ranks: Boolean(row),
        position: row?.position ?? null,
        url: row?.url ?? null,
      };
    });
    const sources = [
      projectRow,
      ...competitorRows.map(({ rows: domainRows }) => domainRows.get(key)),
    ];
    const firstKnown = (read: (row: RankedRow) => number | null) =>
      sources.flatMap((row) => (row ? [read(row)] : [])).find((v) => v != null);
    return {
      keyword:
        projectRow?.keyword ?? sources.find((row) => row)?.keyword ?? key,
      searchVolume: firstKnown((row) => row.searchVolume) ?? null,
      keywordDifficulty: firstKnown((row) => row.keywordDifficulty) ?? null,
      projectRanks: Boolean(projectRow),
      projectPosition: projectRow?.position ?? null,
      projectUrl: projectRow?.url ?? null,
      competitors: cells,
    };
  });

  return {
    missing: sort(
      rows.filter((row) => !row.projectRanks),
      compareGapRows,
    ),
    shared: sort(
      rows.filter((row) => row.projectRanks),
      compareGapRows,
    ),
  };
}

async function run(
  input: { project: GapProject; competitors: string[] },
  customer: BillingCustomerContext,
) {
  const { project } = input;
  const projectDomain = projectTarget(project.domain);
  if (!projectDomain) {
    return { status: "needs_setup", reason: "project_domain_missing" } as const;
  }
  if (!(await hasDataforseoAccess())) {
    return {
      status: "needs_setup",
      reason: "provider_not_configured",
    } as const;
  }

  const competitors = [
    ...new Set(
      input.competitors.map(
        (domain) => parseResearchTargetOrThrow(domain).hostname,
      ),
    ),
  ];
  if (competitors.includes(projectDomain)) {
    throw new AppError(
      "VALIDATION_ERROR",
      "Choose a competitor other than this project's own domain.",
    );
  }

  const market = resolveLabsMarket({}, project);
  // Every domain finishes first, so a retry after one failure reuses the
  // answers that were already paid for.
  const settled = await Promise.allSettled(
    [projectDomain, ...competitors].map((domain) =>
      loadSnapshot(domain, market, project.id, customer),
    ),
  );
  const snapshots = settled.map((result) => {
    if (result.status === "rejected") throw result.reason;
    return result.value;
  });
  const [projectSnapshot, ...competitorSnapshots] = snapshots;

  return {
    status: "ready",
    market,
    isProjectMarket:
      market.locationCode === project.locationCode &&
      market.languageCode === project.languageCode,
    project: coverageOf(projectSnapshot),
    competitors: competitorSnapshots.map(coverageOf),
    ...compareSnapshots(projectSnapshot, competitorSnapshots),
  } as const;
}

export const KeywordGapService = { getSetup, run } as const;
