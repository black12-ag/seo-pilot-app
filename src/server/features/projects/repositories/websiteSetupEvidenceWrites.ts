import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import type { runBatch } from "@/db/runBatch";
import {
  projectCompetitorResearchCandidates as candidates,
  projectCompetitorResearchRuns as runs,
  projectWebsiteResearchAttempts as attempts,
  projects,
} from "@/db/schema";
import { ContentRepository } from "@/server/features/content/repositories/ContentRepository";
import { CompetitorResearchRepository } from "@/server/features/competitor-research/repositories/CompetitorResearchRepository";
import {
  lockAuthorityOrganization,
  lockProject,
} from "@/server/features/site-authority/repositories/siteAuthorityProjectWrites";
import { lockScheduleSponsor } from "@/server/features/audit/repositories/auditScheduleProjectWrites";
import { AppError } from "@/server/lib/errors";
import {
  websiteResearchSchema,
  type SaveProjectWebsiteSetup,
  type WebsiteResearch,
} from "@/types/schemas/projectWebsite";
import type { CompetitorResearchActor } from "@/types/schemas/competitorResearch";

type Tx = Parameters<Parameters<typeof runBatch>[0]>[0];
type Attempt = typeof attempts.$inferSelect;
type Candidate = typeof candidates.$inferSelect;

export type WebsiteSetupEvidence = {
  attempt: Attempt;
  memberId: string;
  requestHash: string;
  saveToken: string;
  run: typeof runs.$inferSelect | null;
  candidates: Map<string, Candidate>;
};

function assertAttempt(
  attempt: Attempt,
  actor: CompetitorResearchActor,
  memberId: string,
  runSeededTracking: boolean,
) {
  if (attempt.redactedAtMs !== null)
    throw new AppError("CONFLICT", "Research evidence was erased.");
  if (
    attempt.reason === "restored" ||
    attempt.sponsorUserId !== actor.userId ||
    attempt.sponsorMemberId !== memberId ||
    attempt.sponsorRole !== actor.role ||
    attempt.surface !== actor.surface ||
    attempt.runSeededTracking !== Number(runSeededTracking)
  )
    throw new AppError("CONFLICT");
}

async function assertReplayable(attempt: Attempt, requestHash: string) {
  if (attempt.saveRequestHash !== requestHash) throw new AppError("CONFLICT");
  if (attempt.competitorRunId) {
    const [run] = await db
      .select({ redactedAtMs: runs.redactedAtMs, reason: runs.reason })
      .from(runs)
      .where(
        and(
          eq(runs.id, attempt.competitorRunId),
          eq(runs.projectId, attempt.projectId),
        ),
      )
      .limit(1);
    if (!run || run.redactedAtMs !== null || run.reason === "restored")
      throw new AppError("CONFLICT");
  }
}

function readReview(attempt: Attempt, input: SaveProjectWebsiteSetup) {
  let parsed: unknown;
  try {
    parsed = JSON.parse(attempt.reviewSnapshotJson ?? "null");
  } catch {
    throw new AppError("CONFLICT");
  }
  const review = websiteResearchSchema.safeParse(parsed);
  if (
    attempt.state !== "review_ready" ||
    !review.success ||
    review.data.domain !== input.domain ||
    attempt.requestedDomain !== input.domain ||
    review.data.name !== input.name ||
    review.data.overview !== input.overview ||
    JSON.stringify(review.data.suggestedTopics) !==
      JSON.stringify(input.suggestedTopics ?? []) ||
    JSON.stringify(review.data.suggestedKeywords) !==
      JSON.stringify(input.suggestedKeywords ?? []) ||
    attempt.competitorRunId !== (input.competitorResearchRunId ?? null) ||
    (input.competitorResearchRunId &&
      input.competitorResearchContextVersion !== attempt.contextVersion) ||
    (!input.competitorResearchRunId &&
      input.competitorResearchContextVersion !== undefined)
  )
    throw new AppError("CONFLICT");
  return review.data;
}

function assertRun(
  run: typeof runs.$inferSelect,
  attempt: Attempt,
  actor: CompetitorResearchActor,
  memberId: string,
) {
  if (
    run.organizationId !== attempt.organizationId ||
    run.origin !== "setup" ||
    run.requestId !== attempt.id ||
    run.sponsorUserId !== actor.userId ||
    run.sponsorMemberId !== memberId ||
    run.sponsorRole !== actor.role ||
    run.surface !== actor.surface ||
    run.contextVersion !== attempt.contextVersion ||
    run.contextHash !== attempt.contextHash ||
    run.domain !== attempt.snapshotDomain ||
    run.locationCode !== attempt.locationCode ||
    run.languageCode !== attempt.languageCode ||
    run.state !== "finished" ||
    !["complete", "partial", "unknown"].includes(run.outcome ?? "") ||
    run.redactedAtMs !== null ||
    run.reviewMutationId !== null
  )
    throw new AppError("CONFLICT");
}

function selectCandidates(
  input: SaveProjectWebsiteSetup,
  review: WebsiteResearch,
  rows: Candidate[],
  hasRun: boolean,
) {
  const selected = new Map<string, Candidate>();
  for (const row of input.competitors.filter(
    (item) => item.researchCandidateId,
  )) {
    const candidate = rows.find((item) => item.id === row.researchCandidateId);
    if (
      !candidate ||
      selected.has(candidate.id) ||
      candidate.domain !== row.domain ||
      candidate.classification !== "verified" ||
      !candidate.sourceUrl ||
      !candidate.sourceExcerpt ||
      !candidate.sourceHash ||
      candidate.sourceCapturedAtMs === null ||
      candidate.selected !== 0 ||
      !review.competitors.some(
        (original) =>
          original.domain === candidate.domain &&
          original.sourceUrl === candidate.sourceUrl,
      )
    )
      throw new AppError("CONFLICT");
    selected.set(candidate.id, candidate);
  }
  if (
    (selected.size && !hasRun) ||
    (hasRun && input.competitors.length && !selected.size)
  )
    throw new AppError("CONFLICT");
  return selected;
}

/** The public input carries references only; the authority and source rows come from SQL. */
export async function prepareWebsiteSetupEvidence(
  input: SaveProjectWebsiteSetup,
  actor: CompetitorResearchActor | undefined,
  organizationId: string,
  requestHash: string,
  runSeededTracking: boolean,
): Promise<
  { replayed: true } | { replayed: false; evidence: WebsiteSetupEvidence }
> {
  if (!actor || actor.organizationId !== organizationId || !actor.userId)
    throw new AppError("FORBIDDEN");
  const membership = await ContentRepository.getMembership(
    organizationId,
    actor.userId,
  );
  if (!membership || membership.role !== actor.role)
    throw new AppError("FORBIDDEN");
  const [attempt] = await db
    .select()
    .from(attempts)
    .where(
      and(
        eq(attempts.id, input.websiteResearchAttemptId!),
        eq(attempts.projectId, input.projectId),
      ),
    )
    .limit(1);
  if (!attempt || attempt.organizationId !== organizationId)
    throw new AppError("CONFLICT");
  assertAttempt(attempt, actor, membership.id, runSeededTracking);
  if (attempt.saveToken !== null) {
    await assertReplayable(attempt, requestHash);
    return { replayed: true };
  }
  const review = readReview(attempt, input);
  const current = await CompetitorResearchRepository.getSnapshot(
    actor,
    input.projectId,
  );
  if (
    current.scope.memberId !== membership.id ||
    current.snapshot.contextVersion !== attempt.contextVersion ||
    current.snapshot.contextHash !== attempt.contextHash ||
    current.snapshot.domain !== attempt.snapshotDomain ||
    current.snapshot.locationCode !== attempt.locationCode ||
    current.snapshot.languageCode !== attempt.languageCode
  )
    throw new AppError("CONFLICT");
  const run = attempt.competitorRunId
    ? ((
        await db
          .select()
          .from(runs)
          .where(
            and(
              eq(runs.id, attempt.competitorRunId),
              eq(runs.projectId, input.projectId),
            ),
          )
          .limit(1)
      )[0] ?? null)
    : null;
  if (run?.reviewMutationId) {
    const [saved] = await db
      .select()
      .from(attempts)
      .where(eq(attempts.id, attempt.id))
      .limit(1);
    if (saved) {
      assertAttempt(saved, actor, membership.id, runSeededTracking);
      if (saved.saveToken) {
        await assertReplayable(saved, requestHash);
        return { replayed: true };
      }
    }
    throw new AppError("CONFLICT");
  }
  if (run) assertRun(run, attempt, actor, membership.id);
  if (attempt.competitorRunId && !run) throw new AppError("CONFLICT");
  const rows = run
    ? await db
        .select()
        .from(candidates)
        .where(
          and(
            eq(candidates.projectId, input.projectId),
            eq(candidates.runId, run.id),
          ),
        )
    : [];
  const selected = selectCandidates(input, review, rows, Boolean(run));
  return {
    replayed: false,
    evidence: {
      attempt,
      memberId: membership.id,
      requestHash,
      saveToken: crypto.randomUUID(),
      run,
      candidates: selected,
    },
  };
}

export function websiteSetupEvidenceStatements(
  tx: Tx,
  evidence: WebsiteSetupEvidence,
  input: SaveProjectWebsiteSetup,
  organizationId: string,
  nowMs: number,
) {
  const { attempt, memberId, run, requestHash, saveToken } = evidence;
  const current = sql`exists (select 1 from projects p join member m on m.organization_id=p.organization_id where p.id=${input.projectId} and p.organization_id=${organizationId} and p.archived_at is null and coalesce(p.domain,'')=coalesce(${attempt.snapshotDomain},'') and p.location_code=${attempt.locationCode} and p.language_code=${attempt.languageCode} and coalesce((select s.context_version from content_project_state s where s.project_id=p.id),0)=${attempt.contextVersion} and m.id=${memberId} and m.user_id=${attempt.sponsorUserId} and m.role=${attempt.sponsorRole})`;
  const candidateGuards = (selected: number) =>
    [...evidence.candidates.values()].map(
      (candidate) =>
        sql`exists (select 1 from project_competitor_research_candidates c where c.id=${candidate.id} and c.project_id=${input.projectId} and c.run_id=${run!.id} and c.domain=${candidate.domain} and c.classification='verified' and c.selected=${selected} and c.source_url=${candidate.sourceUrl} and c.source_hash=${candidate.sourceHash} and c.source_excerpt=${candidate.sourceExcerpt} and c.source_captured_at_ms=${candidate.sourceCapturedAtMs})`,
    );
  const runGuard = run
    ? sql`exists (select 1 from project_competitor_research_runs r where r.id=${run.id} and r.project_id=${input.projectId} and r.organization_id=${organizationId} and r.origin='setup' and r.request_id=${attempt.id} and r.sponsor_user_id=${attempt.sponsorUserId} and r.sponsor_member_id=${memberId} and r.sponsor_role=${attempt.sponsorRole} and r.surface=${attempt.surface} and r.state='finished' and r.outcome in ('complete','partial','unknown') and r.redacted_at_ms is null and r.review_mutation_id is null and r.context_version=${attempt.contextVersion} and r.context_hash=${attempt.contextHash} and coalesce(r.domain,'')=coalesce(${attempt.snapshotDomain},'') and r.location_code=${attempt.locationCode} and r.language_code=${attempt.languageCode})`
    : sql`true`;
  const beforeCandidates = candidateGuards(0);
  const afterCandidates = candidateGuards(1);
  const valid = sql`${current} and ${runGuard} and ${beforeCandidates.length ? sql.join(beforeCandidates, sql` and `) : sql`true`} and ${run ? sql`not exists (select 1 from project_competitors c where c.project_id=${input.projectId})` : sql`true`} and ${input.competitors.length}<=100`;
  const claimed = sql`exists (select 1 from project_website_research_attempts a where a.id=${attempt.id} and a.project_id=${input.projectId} and a.save_token=${saveToken} and a.save_request_hash=${requestHash} and a.sponsor_user_id=${attempt.sponsorUserId} and a.sponsor_member_id=${memberId} and a.sponsor_role=${attempt.sponsorRole} and a.review_hash=${attempt.reviewHash} and a.redacted_at_ms is null and coalesce(a.reason,'')<>'restored')`;
  const runClaimed = run
    ? sql`exists (select 1 from project_competitor_research_runs r where r.id=${run.id} and r.review_mutation_id=${attempt.id} and r.review_token=${saveToken} and r.redacted_at_ms is null and coalesce(r.reason,'')<>'restored')`
    : sql`true`;
  const receipt = sql`${claimed} and ${runClaimed}`;
  const live = sql`exists (select 1 from projects p join member m on m.organization_id=p.organization_id where p.id=${input.projectId} and p.organization_id=${organizationId} and p.archived_at is null and p.domain=${input.domain} and p.location_code=${attempt.locationCode} and p.language_code=${attempt.languageCode} and coalesce((select s.context_version from content_project_state s where s.project_id=p.id),0)=${attempt.contextVersion + 1} and m.id=${memberId} and m.user_id=${attempt.sponsorUserId} and m.role=${attempt.sponsorRole}) and ${afterCandidates.length ? sql.join(afterCandidates, sql` and `) : sql`true`}`;
  return {
    receipt,
    before: [
      lockAuthorityOrganization(tx, organizationId),
      lockProject(tx, input.projectId, organizationId),
      lockScheduleSponsor(tx, attempt.sponsorUserId, organizationId),
      tx
        .update(attempts)
        .set({
          saveToken,
          saveRequestHash: requestHash,
          savedAtMs: nowMs,
          appliedContextVersion: attempt.contextVersion + 1,
        })
        .where(
          and(
            eq(attempts.id, attempt.id),
            eq(attempts.state, "review_ready"),
            sql`${attempts.saveToken} is null and ${attempts.redactedAtMs} is null and coalesce(${attempts.reason},'')<>'restored' and ${attempts.reviewHash}=${attempt.reviewHash} and ${attempts.organizationId}=${organizationId} and ${attempts.sponsorUserId}=${attempt.sponsorUserId} and ${attempts.sponsorMemberId}=${memberId} and ${attempts.sponsorRole}=${attempt.sponsorRole} and ${attempts.surface}=${attempt.surface} and ${attempts.requestedDomain}=${attempt.requestedDomain} and coalesce(${attempts.snapshotDomain},'')=coalesce(${attempt.snapshotDomain},'') and ${attempts.contextVersion}=${attempt.contextVersion} and ${attempts.contextHash}=${attempt.contextHash} and ${attempts.locationCode}=${attempt.locationCode} and ${attempts.languageCode}=${attempt.languageCode} and ${attempts.runSeededTracking}=${attempt.runSeededTracking} and ${attempts.competitorRunId} ${run ? sql`=${run.id}` : sql`is null`} and ${valid}`,
          ),
        ),
      ...(run
        ? [
            tx
              .update(runs)
              .set({
                reviewMutationId: attempt.id,
                reviewToken: saveToken,
                reviewRequestHash: requestHash,
                reviewedAtMs: nowMs,
                reviewedByUserId: attempt.sponsorUserId,
              })
              .where(
                and(
                  eq(runs.id, run.id),
                  sql`${runs.reviewMutationId} is null and ${claimed} and ${runGuard}`,
                ),
              ),
          ]
        : []),
      tx
        .update(projects)
        .set({
          name: sql`case when ${receipt} and ${current} then ${projects.name} else null end`,
        })
        .where(eq(projects.id, input.projectId)),
    ],
    after: [
      tx
        .update(attempts)
        .set({
          appliedContextVersion: sql`coalesce((select s.context_version from content_project_state s where s.project_id=${input.projectId}),0)`,
        })
        .where(and(eq(attempts.id, attempt.id), receipt)),
      ...(run
        ? [
            tx
              .update(runs)
              .set({
                appliedContextVersion: sql`coalesce((select s.context_version from content_project_state s where s.project_id=${input.projectId}),0)`,
              })
              .where(and(eq(runs.id, run.id), receipt)),
          ]
        : []),
      tx
        .update(projects)
        .set({
          name: sql`case when ${receipt} and ${live} then ${projects.name} else null end`,
        })
        .where(eq(projects.id, input.projectId)),
    ],
  };
}
