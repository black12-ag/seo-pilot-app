import {
  and,
  asc,
  desc,
  eq,
  gte,
  inArray,
  lt,
  ne,
  sql,
  type SQLWrapper,
} from "drizzle-orm";
import { db } from "@/db";
import { aiObservations, aiPrompts, aiRuns, aiSources } from "@/db/schema";
import type { AiEngine } from "@/shared/ai-visibility";

interface SourceWindow {
  projectId: string;
  /** Inclusive run start time. */
  start?: string;
  /** Exclusive run start time. */
  end?: string;
}
/** One window, one market and optionally some engines. */
export interface SourceCohort extends SourceWindow {
  locationCode: number;
  languageCode: string;
  engines?: AiEngine[];
}

const total = sql<number>`COUNT(*)`.mapWith(Number);
const distinct = (column: SQLWrapper) =>
  sql<number>`COUNT(DISTINCT ${column})`.mapWith(Number);
/** `www.` is the same site, so it never splits a domain's count. */
const citedDomain = sql<string>`CASE WHEN ${aiSources.domain} LIKE 'www.%' THEN substr(${aiSources.domain}, 5) ELSE ${aiSources.domain} END`;
// SQL `<> ''` is also false for NULL, so this covers both empty forms.
const answered = and(
  eq(aiObservations.status, "completed"),
  ne(aiObservations.answerMarkdown, ""),
);

function inWindow(window: SourceWindow) {
  return and(
    eq(aiRuns.projectId, window.projectId),
    window.start ? gte(aiRuns.createdAt, window.start) : undefined,
    window.end ? lt(aiRuns.createdAt, window.end) : undefined,
  );
}

function inMarket(cohort: SourceCohort) {
  return and(
    inWindow(cohort),
    eq(aiRuns.locationCode, cohort.locationCode),
    eq(aiRuns.languageCode, cohort.languageCode),
  );
}

function inCohort(cohort: SourceCohort) {
  return and(
    inMarket(cohort),
    cohort.engines ? inArray(aiObservations.engine, cohort.engines) : undefined,
  );
}

function citedBy(domain?: string) {
  return domain
    ? inArray(aiSources.domain, [domain, `www.${domain}`])
    : undefined;
}

/** Every market with a run in the window. */
export function listWindowMarkets(window: SourceWindow) {
  return db
    .select({
      locationCode: aiRuns.locationCode,
      languageCode: aiRuns.languageCode,
      runs: total,
      latestRunAt: sql<string>`MAX(${aiRuns.createdAt})`,
    })
    .from(aiRuns)
    .where(inWindow(window))
    .groupBy(aiRuns.locationCode, aiRuns.languageCode);
}

/** Answer counts by engine and outcome, across every engine in the market. */
export function getMarketCoverage(cohort: SourceCohort) {
  // Written without bound values: Postgres only matches a GROUP BY expression
  // to its SELECT twin when they share no parameters.
  const answerText = sql<number>`CASE WHEN ${aiObservations.answerMarkdown} <> '' THEN 1 ELSE 0 END`;
  return db
    .select({
      engine: aiObservations.engine,
      status: aiObservations.status,
      answered: answerText.mapWith(Number),
      count: total,
    })
    .from(aiObservations)
    .innerJoin(aiRuns, eq(aiRuns.id, aiObservations.runId))
    .where(inMarket(cohort))
    .groupBy(aiObservations.engine, aiObservations.status, answerText);
}

/** Each run with how many prompt and engine pairs it asked. */
export function listCohortRuns(cohort: SourceCohort) {
  return db
    .select({
      runId: aiObservations.runId,
      createdAt: aiRuns.createdAt,
      pairs: total,
    })
    .from(aiObservations)
    .innerJoin(aiRuns, eq(aiRuns.id, aiObservations.runId))
    .where(inCohort(cohort))
    .groupBy(aiObservations.runId, aiRuns.createdAt);
}

/** Distinct prompts, and distinct prompt and engine pairs, across the cohort. */
export async function getCohortPromptSet(cohort: SourceCohort) {
  const [row] = await db
    .select({
      prompts: distinct(aiObservations.promptId),
      pairs: distinct(
        sql`${aiObservations.promptId} || '|' || ${aiObservations.engine}`,
      ),
    })
    .from(aiObservations)
    .innerJoin(aiRuns, eq(aiRuns.id, aiObservations.runId))
    .where(inCohort(cohort));
  return row ?? { prompts: 0, pairs: 0 };
}

/** Per domain, each answer counts once however many of its pages it cites. */
export function listCitedDomains(cohort: SourceCohort, domain?: string) {
  return db
    .select({
      domain: citedDomain,
      answers: distinct(aiObservations.id),
      prompts: distinct(aiObservations.promptId),
      pages: distinct(aiSources.url),
    })
    .from(aiSources)
    .innerJoin(aiObservations, eq(aiObservations.id, aiSources.observationId))
    .innerJoin(aiRuns, eq(aiRuns.id, aiObservations.runId))
    .where(and(inCohort(cohort), answered, citedBy(domain)))
    .groupBy(citedDomain);
}

export function listCitedDomainEngines(cohort: SourceCohort, domain?: string) {
  return db
    .select({
      domain: citedDomain,
      engine: aiObservations.engine,
      answers: distinct(aiObservations.id),
    })
    .from(aiSources)
    .innerJoin(aiObservations, eq(aiObservations.id, aiSources.observationId))
    .innerJoin(aiRuns, eq(aiRuns.id, aiObservations.runId))
    .where(and(inCohort(cohort), answered, citedBy(domain)))
    .groupBy(citedDomain, aiObservations.engine);
}

/** One domain's pages, most cited first. */
export function listCitedPages(
  cohort: SourceCohort,
  domain: string,
  limit: number,
) {
  const answers = distinct(aiObservations.id);
  return db
    .select({
      url: aiSources.url,
      title: sql<string | null>`MAX(${aiSources.title})`,
      answers,
    })
    .from(aiSources)
    .innerJoin(aiObservations, eq(aiObservations.id, aiSources.observationId))
    .innerJoin(aiRuns, eq(aiRuns.id, aiObservations.runId))
    .where(and(inCohort(cohort), answered, citedBy(domain)))
    .groupBy(aiSources.url)
    .orderBy(desc(answers), asc(aiSources.url))
    .limit(limit);
}

/** One page of the answers citing a domain, newest run first. */
export function listCitingAnswers(
  cohort: SourceCohort,
  domain: string,
  page: { limit: number; offset: number },
) {
  return db
    .selectDistinct({
      observationId: aiObservations.id,
      runId: aiObservations.runId,
      runCreatedAt: aiRuns.createdAt,
      trigger: aiRuns.trigger,
      promptId: aiObservations.promptId,
      prompt: aiPrompts.text,
      topic: aiPrompts.topic,
      engine: aiObservations.engine,
      collectedAt: aiObservations.collectedAt,
    })
    .from(aiSources)
    .innerJoin(aiObservations, eq(aiObservations.id, aiSources.observationId))
    .innerJoin(aiRuns, eq(aiRuns.id, aiObservations.runId))
    .innerJoin(aiPrompts, eq(aiPrompts.id, aiObservations.promptId))
    .where(and(inCohort(cohort), answered, citedBy(domain)))
    .orderBy(
      desc(aiRuns.createdAt),
      asc(aiPrompts.text),
      asc(aiObservations.engine),
      asc(aiObservations.id),
    )
    .limit(page.limit)
    .offset(page.offset);
}

/** The domain's pages in the given answers, in the engine's order. */
export function listCitedUrls(observationIds: string[], domain: string) {
  return db
    .select({
      observationId: aiSources.observationId,
      url: aiSources.url,
      title: aiSources.title,
    })
    .from(aiSources)
    .where(
      and(inArray(aiSources.observationId, observationIds), citedBy(domain)),
    )
    .orderBy(asc(aiSources.position));
}
