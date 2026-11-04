import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { runBatch } from "@/db/runBatch";
import {
  projectWebsiteResearchAttempts as attempts,
  projects,
} from "@/db/schema";
import type { ConfigurationRows } from "@/server/features/ai-visibility/repositories/aiVisibilityConfigurationRepository";
import {
  writeConfiguration,
  writeResearchKeywords,
} from "@/server/features/ai-visibility/repositories/aiVisibilityConfigurationRepository";
import type { CompetitorResearchScope } from "@/server/features/competitor-research/repositories/CompetitorResearchRepository";
import {
  websiteResearchSchema,
  type WebsiteResearch,
} from "@/types/schemas/projectWebsite";
import { scoped } from "./websiteResearchAttemptReads";
import { locks } from "./websiteResearchAttemptWrites";

type Input = {
  attemptId: string;
  admissionToken: string;
  executionToken: string;
  review: WebsiteResearch;
  tracking: ConfigurationRows | null;
  nowMs: number;
};

/** Commit a topics-only AI setup and its terminal receipt in one transaction. */
export async function completeTopics(
  scope: CompetitorResearchScope,
  input: Input,
) {
  const review = websiteResearchSchema.parse(input.review);
  if (!Number.isSafeInteger(input.nowMs) || input.nowMs < 0)
    return { kind: "conflict" } as const;
  const [header] = await db
    .select({ projectId: attempts.projectId })
    .from(attempts)
    .where(eq(attempts.id, input.attemptId))
    .limit(1);
  if (!header) return { kind: "blocked" } as const;
  const row = await scoped(scope, header.projectId, input.attemptId).catch(
    () => null,
  );
  if (!row) return { kind: "blocked" } as const;
  if (row.state === "finished_no_review")
    return { kind: "already_finished" } as const;
  if (
    row.mode !== "ai_setup" ||
    row.state !== "running" ||
    row.admissionToken !== input.admissionToken ||
    row.executionToken !== input.executionToken ||
    row.competitorRunId !== null ||
    row.redactedAtMs !== null ||
    row.reason === "restored" ||
    row.deadlineAtMs <= input.nowMs ||
    review.domain !== (row.snapshotDomain ?? row.requestedDomain) ||
    !review.preserveCompetitors ||
    review.competitors.length !== 0
  )
    return { kind: "blocked" } as const;
  const marker = crypto.randomUUID();
  const authority = sql`exists (select 1 from projects p join member m on m.organization_id=p.organization_id
    where p.id=${row.projectId} and p.organization_id=${row.organizationId} and p.archived_at is null
      and coalesce(p.domain,'')=coalesce(${row.snapshotDomain},'')
      and p.location_code=${row.locationCode} and p.language_code=${row.languageCode}
      and coalesce((select s.context_version from content_project_state s where s.project_id=p.id),0)=${row.contextVersion}
      and m.id=${row.sponsorMemberId} and m.user_id=${row.sponsorUserId} and m.role=${row.sponsorRole})`;
  const ready = sql`${authority} and exists (select 1 from project_context_sections s where s.project_id=${row.projectId} and s.key='business_overview')
    and exists (select 1 from project_competitors c where c.project_id=${row.projectId})
    and exists (select 1 from projects p where p.id=${row.projectId} and p.ai_research_keywords is null)
    ${input.tracking ? sql`and not exists (select 1 from ai_trackers t where t.project_id=${row.projectId})` : sql``}`;
  const receipt = sql`exists (select 1 from project_website_research_attempts a where a.id=${row.id} and a.project_id=${row.projectId}
    and a.state='finished_no_review' and a.execution_token=${marker} and a.redacted_at_ms is null) and ${authority}`;
  try {
    await runBatch((tx) => [
      ...locks(tx, row),
      tx
        .update(attempts)
        .set({
          state: "finished_no_review",
          activeProjectId: null,
          executionToken: marker,
          finishedAtMs: input.nowMs,
          reason: "topics_saved",
        })
        .where(
          and(
            eq(attempts.id, row.id),
            eq(attempts.state, "running"),
            eq(attempts.admissionToken, input.admissionToken),
            eq(attempts.executionToken, input.executionToken),
            sql`${attempts.competitorRunId} is null`,
            sql`${attempts.redactedAtMs} is null`,
            ready,
          ),
        ),
      tx
        .update(projects)
        .set({ name: sql`null` })
        .where(and(eq(projects.id, row.projectId), sql`not (${receipt})`)),
      ...(input.tracking ? writeConfiguration(tx, input.tracking) : []),
      ...writeResearchKeywords(tx, row.projectId, [
        ...review.suggestedTopics.map((topic) => topic.name),
        ...review.suggestedKeywords,
      ]),
      tx
        .update(projects)
        .set({ name: sql`null` })
        .where(and(eq(projects.id, row.projectId), sql`not (${receipt})`)),
    ]);
  } catch (error) {
    const cause =
      error && typeof error === "object" && "cause" in error
        ? error.cause
        : error;
    if (
      cause &&
      typeof cause === "object" &&
      "code" in cause &&
      (cause.code === "SQLITE_CONSTRAINT_NOTNULL" || cause.code === "23502")
    ) {
      const [after] = await db
        .select({ state: attempts.state })
        .from(attempts)
        .where(eq(attempts.id, row.id))
        .limit(1);
      if (after?.state === "finished_no_review")
        return { kind: "already_finished" } as const;
      const [check] = await db
        .select({ value: ready })
        .from(projects)
        .where(eq(projects.id, row.projectId))
        .limit(1);
      if (!check?.value) return { kind: "blocked" } as const;
    }
    throw error;
  }
  const [current] = await db
    .select({ state: attempts.state, marker: attempts.executionToken })
    .from(attempts)
    .where(eq(attempts.id, row.id))
    .limit(1);
  return current?.state === "finished_no_review" && current.marker === marker
    ? ({ kind: "applied" } as const)
    : ({ kind: "blocked" } as const);
}
