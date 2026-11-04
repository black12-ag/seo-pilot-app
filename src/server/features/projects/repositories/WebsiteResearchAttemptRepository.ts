import { eq, sql } from "drizzle-orm";
import { runBatch } from "@/db/runBatch";
import { db } from "@/db";
import { projectWebsiteResearchAttempts as attempts } from "@/db/schema";
import {
  CompetitorResearchRepository,
  type CompetitorResearchScope,
} from "@/server/features/competitor-research/repositories/CompetitorResearchRepository";
import { AppError } from "@/server/lib/errors";
import { normalizeBacklinksTarget } from "@/server/lib/dataforseoBacklinksTarget";
import { sha256Hex } from "@/server/lib/audit/ids";
import {
  competitorResearchSnapshotSchema,
  type CompetitorResearchSnapshot,
} from "@/types/schemas/competitorResearch";
import {
  researchProjectWebsiteSchema,
  type WebsiteResearch,
} from "@/types/schemas/projectWebsite";
import {
  authorizeProject,
  scoped,
  get,
  getLatestAi,
  getActive,
  getAuthority,
  lookupExistingForStart,
} from "./websiteResearchAttemptReads";
import {
  locks,
  claimExecution as claimExecutionWrite,
  linkCompetitorRun as linkCompetitorRunWrite,
  complete as completeWrite,
  finish,
} from "./websiteResearchAttemptWrites";
import { completeTopics } from "./websiteResearchTopicsWrites";

type Mode = "direct" | "ai_setup";
type AdmissionInput = {
  id: string;
  projectId: string;
  mode: Mode;
  requestedWebsite: string;
  runSeededTracking: boolean;
  snapshot: CompetitorResearchSnapshot;
  nowMs: number;
};

async function admit(scope: CompetitorResearchScope, input: AdmissionInput) {
  if (
    !scope.requireMembership ||
    !scope.memberId ||
    !scope.actor.userId ||
    !scope.actor.organizationId ||
    !["direct", "ai_setup"].includes(input.mode) ||
    !Number.isSafeInteger(input.nowMs) ||
    input.nowMs < 0
  )
    throw new AppError("VALIDATION_ERROR");
  const requestedWebsite = researchProjectWebsiteSchema.shape.website.parse(
    input.requestedWebsite,
  );
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      input.id,
    )
  )
    throw new AppError("VALIDATION_ERROR");
  const snapshot = competitorResearchSnapshotSchema.parse(input.snapshot);
  const requestedDomain = normalizeBacklinksTarget(requestedWebsite, {
    scope: "domain",
  }).apiTarget;
  const requestHash = await sha256Hex(
    JSON.stringify([
      input.mode,
      scope.actor.surface,
      requestedWebsite,
      requestedDomain,
      input.runSeededTracking,
      snapshot,
      scope.actor.userId,
      scope.memberId,
      scope.actor.role,
    ]),
  );
  const [existing] = await db
    .select()
    .from(attempts)
    .where(eq(attempts.id, input.id))
    .limit(1);
  if (existing) {
    if (
      existing.projectId !== input.projectId ||
      existing.organizationId !== scope.actor.organizationId
    )
      return { kind: "conflict" } as const;
    await authorizeProject(scope, input.projectId);
    if (existing.redactedAtMs !== null)
      return { kind: "privacy_erased", attemptId: input.id } as const;
    if (existing.reason === "restored") return { kind: "conflict" } as const;
    const authorized = await scoped(scope, input.projectId, input.id).catch(
      () => null,
    );
    if (!authorized) return { kind: "conflict" } as const;
    return existing.requestHash === requestHash
      ? ({ kind: "replayed", attemptId: input.id } as const)
      : ({ kind: "conflict" } as const);
  }
  const current = await CompetitorResearchRepository.getSnapshot(
    scope.actor,
    input.projectId,
  );
  if (
    current.scope.memberId !== scope.memberId ||
    JSON.stringify(current.snapshot) !== JSON.stringify(snapshot)
  )
    return { kind: "conflict" } as const;
  const admissionToken = crypto.randomUUID();
  const row = {
    id: input.id,
    projectId: input.projectId,
    organizationId: scope.actor.organizationId,
    mode: input.mode,
    surface: scope.actor.surface,
    sponsorUserId: scope.actor.userId,
    sponsorMemberId: scope.memberId,
    sponsorRole: scope.actor.role,
    requestHash,
    admissionToken,
    executionToken: null,
    requestedWebsite,
    requestedDomain,
    snapshotDomain: snapshot.domain,
    locationCode: snapshot.locationCode,
    languageCode: snapshot.languageCode,
    contextVersion: snapshot.contextVersion,
    contextHash: snapshot.contextHash,
    runSeededTracking: input.runSeededTracking ? 1 : 0,
    competitorRunId: null,
    state: "admitted",
    activeProjectId: input.projectId,
    createdAtMs: input.nowMs,
    startedAtMs: null,
    deadlineAtMs: input.nowMs + 300000,
    finishedAtMs: null,
    reason: null,
    redactedAtMs: null,
    reviewSnapshotJson: null,
    reviewHash: null,
    saveToken: null,
    saveRequestHash: null,
    savedAtMs: null,
    appliedContextVersion: null,
  } as const;
  const guard = sql`exists (select 1 from projects p join member m on m.organization_id=p.organization_id where p.id=${input.projectId} and p.organization_id=${scope.actor.organizationId} and p.archived_at is null and coalesce(p.domain,'')=coalesce(${snapshot.domain},'') and p.location_code=${snapshot.locationCode} and p.language_code=${snapshot.languageCode} and coalesce((select s.context_version from content_project_state s where s.project_id=p.id),0)=${snapshot.contextVersion} and m.id=${scope.memberId} and m.user_id=${scope.actor.userId} and m.role=${scope.actor.role})`;
  await runBatch((tx) => [
    ...locks(tx, row),
    tx
      .insert(attempts)
      .select(
        sql`select ${row.id},${row.projectId},${row.organizationId},${row.mode},${row.surface},${row.sponsorUserId},${row.sponsorMemberId},${row.sponsorRole},${row.requestHash},${row.admissionToken},null,${row.requestedWebsite},${row.requestedDomain},${row.snapshotDomain},${row.locationCode},${row.languageCode},${row.contextVersion},${row.contextHash},${row.runSeededTracking},null,${row.state},${row.activeProjectId},${row.createdAtMs},null,${row.deadlineAtMs},null,null,null,null,null,null,null,null,null where ${guard}`,
      )
      .onConflictDoNothing(),
  ]);
  const [receipt] = await db
    .select()
    .from(attempts)
    .where(eq(attempts.id, input.id))
    .limit(1);
  if (
    receipt &&
    receipt.projectId === input.projectId &&
    receipt.organizationId === scope.actor.organizationId
  ) {
    await authorizeProject(scope, input.projectId);
    if (receipt.redactedAtMs !== null)
      return { kind: "privacy_erased", attemptId: input.id } as const;
    if (receipt.reason === "restored") return { kind: "conflict" } as const;
    if (receipt.admissionToken === admissionToken)
      return { kind: "created", attemptId: input.id, admissionToken } as const;
    return receipt.requestHash === requestHash &&
      receipt.sponsorUserId === scope.actor.userId &&
      receipt.sponsorMemberId === scope.memberId &&
      receipt.sponsorRole === scope.actor.role
      ? ({ kind: "replayed", attemptId: input.id } as const)
      : ({ kind: "conflict" } as const);
  }
  const [active] = await db
    .select({ id: attempts.id })
    .from(attempts)
    .where(eq(attempts.activeProjectId, input.projectId))
    .limit(1);
  return active ? ({ kind: "busy" } as const) : ({ kind: "conflict" } as const);
}

async function scopedById(scope: CompetitorResearchScope, id: string) {
  const [row] = await db
    .select({ projectId: attempts.projectId })
    .from(attempts)
    .where(eq(attempts.id, id))
    .limit(1);
  return scoped(scope, row?.projectId ?? "", id);
}

async function claimExecution(
  scope: CompetitorResearchScope,
  id: string,
  admissionToken: string,
  nowMs: number,
) {
  const row = await scopedById(scope, id);
  if (!(await getAuthority(id, nowMs))) return { kind: "blocked" } as const;
  return claimExecutionWrite(row, admissionToken, nowMs);
}

async function linkCompetitorRun(
  scope: CompetitorResearchScope,
  id: string,
  executionToken: string,
  runId: string,
  nowMs: number,
) {
  const row = await scopedById(scope, id);
  if (!(await getAuthority(id, nowMs))) return { kind: "blocked" } as const;
  return linkCompetitorRunWrite(row, executionToken, runId, nowMs);
}

async function complete(
  scope: CompetitorResearchScope,
  id: string,
  executionToken: string,
  review: WebsiteResearch,
  nowMs: number,
) {
  const row = await scopedById(scope, id);
  if (row.state !== "review_ready" && !(await getAuthority(id, nowMs)))
    return { kind: "blocked" } as const;
  return completeWrite(row, executionToken, review, nowMs);
}

/** An attempt that lost authority before its claim must not keep the lock. */
async function releaseUnstarted(id: string, nowMs: number) {
  const [row] = await db
    .select({ state: attempts.state, admissionToken: attempts.admissionToken })
    .from(attempts)
    .where(eq(attempts.id, id))
    .limit(1);
  if (row?.state === "admitted")
    await finish(
      id,
      { admissionToken: row.admissionToken },
      "failed",
      "pre_execution_blocked",
      nowMs,
    );
}

export const WebsiteResearchAttemptRepository = {
  getActive,
  releaseUnstarted,
  admit,
  get,
  lookupExistingForStart,
  getLatestAi,
  getAuthority,
  claimExecution,
  linkCompetitorRun,
  complete,
  completeTopics,
  finish,
};
