import { groupByProp, sort } from "remeda";
import type {
  AiBrand,
  AiEngine,
  AiMarket,
  AiSourceCohort,
  AiSourceDetail,
  AiSourceOwnership,
  AiSourceReport,
} from "@/shared/ai-visibility";
import {
  aiEngineSchema,
  type AiSourceCohortInput,
  type AiSourceDetailInput,
  type AiSourceReportInput,
} from "@/types/schemas/ai-visibility";
import { AiVisibilityRepository as repo } from "../repositories/AiVisibilityRepository";
import {
  getCohortPromptSet,
  getMarketCoverage,
  listCitedDomainEngines,
  listCitedDomains,
  listCitedPages,
  listCitedUrls,
  listCitingAnswers,
  listCohortRuns,
  listWindowMarkets,
  type SourceCohort,
} from "../repositories/aiVisibilitySourcesRepository";
import { aiBrands } from "./aiVisibilityConfiguration";
import { ownedAiDomain } from "./aiVisibilityMatching";

const PAGE_LIMIT = 100;
const ANSWERS_PER_PAGE = 50;

const instant = (value: string | null | undefined) =>
  value ? new Date(value).toISOString() : undefined;

function sameMarket(a: AiMarket, b: AiMarket) {
  return a.locationCode === b.locationCode && a.languageCode === b.languageCode;
}

function emptyTally() {
  return { answered: 0, noAnswer: 0, failed: 0, pending: 0 };
}

/**
 * The answers one report counts. A cohort is always one market: the requested
 * one when the window has runs there, otherwise the latest run's.
 */
async function loadCohort(
  input: AiSourceCohortInput,
): Promise<{ cohort: AiSourceCohort; scope: SourceCohort | null }> {
  const window = {
    projectId: input.projectId,
    start: instant(input.start),
    end: instant(input.end),
  };
  const markets = sort(
    await listWindowMarkets(window),
    (a, b) =>
      b.latestRunAt.localeCompare(a.latestRunAt) ||
      a.locationCode - b.locationCode ||
      a.languageCode.localeCompare(b.languageCode),
  );
  const { market: requested } = input;
  const chosen =
    (requested && markets.find((item) => sameMarket(item, requested))) ??
    markets[0];
  const empty: AiSourceCohort = {
    start: window.start ?? null,
    end: window.end ?? null,
    firstRunAt: null,
    lastRunAt: null,
    runs: 0,
    prompts: 0,
    market: null,
    markets: markets.map(({ locationCode, languageCode, runs }) => ({
      locationCode,
      languageCode,
      runs,
    })),
    promptSetVaries: false,
    answers: emptyTally(),
    engines: [],
    availableEngines: [],
  };
  if (!chosen) return { cohort: empty, scope: null };
  const market = {
    locationCode: chosen.locationCode,
    languageCode: chosen.languageCode,
  };
  const scope = { ...window, ...market, engines: input.engines ?? undefined };
  const [coverage, runs, promptSet] = await Promise.all([
    getMarketCoverage(scope),
    listCohortRuns(scope),
    getCohortPromptSet(scope),
  ]);
  const tallies = new Map<AiEngine, ReturnType<typeof emptyTally>>();
  const answers = emptyTally();
  for (const row of coverage) {
    if (scope.engines && !scope.engines.includes(row.engine)) continue;
    const tally = tallies.get(row.engine) ?? emptyTally();
    const outcome =
      row.status === "pending"
        ? "pending"
        : row.status === "failed"
          ? "failed"
          : row.answered
            ? "answered"
            : "noAnswer";
    tally[outcome] += row.count;
    answers[outcome] += row.count;
    tallies.set(row.engine, tally);
  }
  const available = new Set(coverage.map((row) => row.engine));
  const started = sort(
    runs.map((run) => run.createdAt),
    (a, b) => a.localeCompare(b),
  );
  return {
    scope,
    cohort: {
      ...empty,
      firstRunAt: started[0] ?? null,
      lastRunAt: started.at(-1) ?? null,
      runs: runs.length,
      prompts: promptSet.prompts,
      market,
      // A run has one row per prompt and engine, so a run that asked every
      // pair in the cohort has exactly that many rows.
      promptSetVaries: runs.some((run) => run.pairs !== promptSet.pairs),
      answers,
      engines: aiEngineSchema.options.flatMap((engine) => {
        const tally = tallies.get(engine);
        return tally ? [{ engine, ...tally }] : [];
      }),
      availableEngines: aiEngineSchema.options.filter((engine) =>
        available.has(engine),
      ),
    },
  };
}

/** From the current project domain and saved competitors. */
async function loadBrands(projectId: string) {
  const [project, competitors] = await Promise.all([
    repo.getProject(projectId),
    repo.listCompetitors(projectId),
  ]);
  return project ? aiBrands(project, competitors) : [];
}

function ownershipOf(domain: string, brands: AiBrand[]): AiSourceOwnership {
  const owned = (brand: AiBrand) => ownedAiDomain(domain, brand.domain);
  if (brands.some((brand) => brand.own && owned(brand))) return "own";
  return brands.some((brand) => !brand.own && owned(brand))
    ? "competitor"
    : "other";
}

/** Cited domains in one cohort, paged after the ownership filter. */
export async function loadAiSourceReport(
  input: AiSourceReportInput,
): Promise<AiSourceReport> {
  const { cohort, scope } = await loadCohort(input);
  if (!scope) return { cohort, rows: [], totalCount: 0, nextCursor: null };
  const [brands, domains, engines] = await Promise.all([
    loadBrands(input.projectId),
    listCitedDomains(scope),
    listCitedDomainEngines(scope),
  ]);
  const enginesByDomain = groupByProp(engines, "domain");
  const rows = sort(
    domains
      .map((row) => ({
        ...row,
        ownership: ownershipOf(row.domain, brands),
        engines: (enginesByDomain[row.domain] ?? []).map(
          ({ engine, answers }) => ({ engine, answers }),
        ),
      }))
      .filter(
        (row) => input.ownership === "all" || row.ownership === input.ownership,
      ),
    (a, b) => b.answers - a.answers || a.domain.localeCompare(b.domain),
  );
  const offset = Number(input.cursor ?? 0);
  return {
    cohort,
    rows: rows.slice(offset, offset + input.limit),
    totalCount: rows.length,
    nextCursor:
      offset + input.limit < rows.length ? String(offset + input.limit) : null,
  };
}

/** One domain's cited pages and the answers and prompts behind them. */
export async function loadAiSourceDetail(
  input: AiSourceDetailInput,
): Promise<AiSourceDetail> {
  const domain = input.domain.replace(/^www\./, "");
  const { cohort, scope } = await loadCohort(input);
  const brands = await loadBrands(input.projectId);
  const empty: AiSourceDetail = {
    cohort,
    domain,
    ownership: ownershipOf(domain, brands),
    citedAnswers: 0,
    citedPrompts: 0,
    pageCount: 0,
    engines: [],
    pages: [],
    answers: [],
    nextCursor: null,
  };
  if (!scope) return empty;
  const offset = Number(input.cursor ?? 0);
  const [[totals], engines, pages, answers] = await Promise.all([
    listCitedDomains(scope, domain),
    listCitedDomainEngines(scope, domain),
    listCitedPages(scope, domain, PAGE_LIMIT),
    listCitingAnswers(scope, domain, { limit: ANSWERS_PER_PAGE, offset }),
  ]);
  if (!totals) return empty;
  const urls = groupByProp(
    await listCitedUrls(
      answers.map((answer) => answer.observationId),
      domain,
    ),
    "observationId",
  );
  return {
    ...empty,
    citedAnswers: totals.answers,
    citedPrompts: totals.prompts,
    pageCount: totals.pages,
    engines: engines.map(({ engine, answers: count }) => ({
      engine,
      answers: count,
    })),
    pages,
    answers: answers.map((answer) => ({
      ...answer,
      pages: (urls[answer.observationId] ?? []).map(({ url, title }) => ({
        url,
        title,
      })),
    })),
    nextCursor:
      offset + ANSWERS_PER_PAGE < totals.answers
        ? String(offset + ANSWERS_PER_PAGE)
        : null,
  };
}
