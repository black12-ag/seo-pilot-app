import { sort } from "remeda";
import { runBatch } from "@/db/runBatch";
import { AuthRepository } from "@/server/auth/repositories/AuthRepository";
import { accept, recordSetupEvidence } from "./competitorResearchReviewWrites";
import { recordSetupSettlement } from "./competitorResearchSetupWrites";
import {
  recordSearch,
  recordPage,
  recordClassification,
} from "./competitorResearchEvidenceWrites";
import { admit, admitSetup } from "./competitorResearchWrites";
import { competitorResearchPrivacyQueries } from "./competitorResearchPrivacyWrites";
import * as privacySchema from "@/db/schema";
import {
  finish,
  claimBilling,
  recordBilling,
  recordOperationFailure,
  issueOperation,
  prepareOperation,
} from "./competitorResearchOperationWrites";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  projects,
  projectCompetitorResearchCandidates as candidates,
  projectCompetitorResearchOperations as operations,
  projectCompetitorResearchRuns as runs,
} from "@/db/schema";
import { ContentRepository } from "@/server/features/content/repositories/ContentRepository";
import { ProjectContextRepository } from "@/server/features/project-context/repositories/ProjectContextRepository";
import { ProjectRepository } from "@/server/features/projects/repositories/ProjectRepository";
import { AiVisibilityRepository } from "@/server/features/ai-visibility/repositories/AiVisibilityRepository";
import { sha256Hex } from "@/server/lib/audit/ids";
import { AppError } from "@/server/lib/errors";
import { usesBetterAuthServer } from "@/server/lib/runtime-env";
import type { CompetitorResearchActor } from "@/types/schemas/competitorResearch";

export type CompetitorResearchScope = {
  actor: CompetitorResearchActor;
  memberId: string | null;
  requireMembership: boolean;
};

async function getSnapshot(actor: CompetitorResearchActor, projectId: string) {
  if (!actor.userId || !actor.organizationId)
    throw new AppError("UNAUTHENTICATED");
  const requireMembership = await usesBetterAuthServer();
  const membership = requireMembership
    ? await ContentRepository.getMembership(actor.organizationId, actor.userId)
    : null;
  if (requireMembership && (!membership || membership.role !== actor.role))
    throw new AppError("FORBIDDEN");
  const scope: CompetitorResearchScope = {
    actor,
    memberId: membership?.id ?? null,
    requireMembership,
  };
  for (let attempt = 0; attempt < 3; attempt++) {
    const version = await ContentRepository.getContextVersion(
      actor.organizationId,
      projectId,
    );
    if (version === null) throw new AppError("NOT_FOUND");
    const [project, sections, competitors, keywords] = await Promise.all([
      ProjectRepository.getProjectForOrganization(
        projectId,
        actor.organizationId,
      ),
      ProjectContextRepository.listSections(projectId),
      ProjectContextRepository.listCompetitors(projectId),
      AiVisibilityRepository.listResearchKeywords(projectId),
    ]);
    const after = await ContentRepository.getContextVersion(
      actor.organizationId,
      projectId,
    );
    if (!project || after === null) throw new AppError("NOT_FOUND");
    if (version !== after) continue;
    const canonical = {
      name: project.name,
      domain: project.domain,
      locationCode: project.locationCode,
      languageCode: project.languageCode,
      sections: sort(
        sections.map(({ key, title, content }) => ({ key, title, content })),
        (a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0),
      ),
      competitors: sort(
        competitors.map(({ id, domain, name, notes }) => ({
          id,
          domain,
          name,
          notes,
        })),
        (a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
      ),
    };
    return {
      scope,
      snapshot: {
        domain: project.domain,
        locationCode: project.locationCode,
        languageCode: project.languageCode,
        contextVersion: version,
        contextHash: await sha256Hex(JSON.stringify(canonical)),
      },
      businessSummary:
        sections.find((section) => section.key === "business_overview")
          ?.content ?? "",
      keywords,
      savedDomains: competitors.map((row) => row.domain),
    };
  }
  throw new AppError("CONFLICT", "context_changed");
}

async function authorize(scope: CompetitorResearchScope, projectId: string) {
  const [project, membership] = await Promise.all([
    ProjectRepository.getProjectForOrganization(
      projectId,
      scope.actor.organizationId,
    ),
    scope.requireMembership
      ? ContentRepository.getMembership(
          scope.actor.organizationId,
          scope.actor.userId,
        )
      : null,
  ]);
  if (!project) throw new AppError("NOT_FOUND");
  if (
    scope.requireMembership &&
    (!membership ||
      membership.id !== scope.memberId ||
      membership.role !== scope.actor.role)
  )
    throw new AppError("FORBIDDEN");
}

async function getRun(
  scope: CompetitorResearchScope,
  projectId: string,
  runId: string,
) {
  await authorize(scope, projectId);
  const [run] = await db
    .select()
    .from(runs)
    .where(
      and(
        eq(runs.id, runId),
        eq(runs.projectId, projectId),
        eq(runs.organizationId, scope.actor.organizationId),
      ),
    )
    .limit(1);
  if (!run) throw new AppError("NOT_FOUND");
  if (run.redactedAtMs !== null) return { run, candidates: [], operations: [] };
  const [candidateRows, operationRows] = await Promise.all([
    db
      .select()
      .from(candidates)
      .where(
        and(eq(candidates.projectId, projectId), eq(candidates.runId, runId)),
      ),
    db
      .select()
      .from(operations)
      .where(
        and(eq(operations.projectId, projectId), eq(operations.runId, runId)),
      ),
  ]);
  return { run, candidates: candidateRows, operations: operationRows };
}

async function listRecent(scope: CompetitorResearchScope, projectId: string) {
  await authorize(scope, projectId);
  return db
    .select()
    .from(runs)
    .where(
      and(
        eq(runs.projectId, projectId),
        eq(runs.organizationId, scope.actor.organizationId),
        isNull(runs.redactedAtMs),
      ),
    )
    .orderBy(desc(runs.createdAtMs), desc(runs.id))
    .limit(10);
}

/** Exact internal lookup for an admitted setup run whose attempt link was lost. */
async function getSetupRunByRequest(
  scope: CompetitorResearchScope,
  projectId: string,
  requestId: string,
) {
  await authorize(scope, projectId);
  if (!scope.requireMembership || !scope.memberId)
    throw new AppError("FORBIDDEN");
  const liveMember = sql`exists (select 1 from projects p join member m on m.organization_id=p.organization_id
    where p.id=${projectId} and p.organization_id=${scope.actor.organizationId} and p.archived_at is null
    and m.id=${scope.memberId} and m.user_id=${scope.actor.userId} and m.role=${scope.actor.role})`;
  const [run] = await db
    .select()
    .from(runs)
    .where(
      and(
        eq(runs.projectId, projectId),
        eq(runs.organizationId, scope.actor.organizationId),
        eq(runs.requestId, requestId),
        eq(runs.origin, "setup"),
        liveMember,
      ),
    )
    .limit(1);
  return run ?? null;
}

async function getAuthority(runId: string) {
  const [run] = await db.select().from(runs).where(eq(runs.id, runId)).limit(1);
  if (
    !run ||
    run.redactedAtMs !== null ||
    !run.sponsorUserId ||
    !run.sponsorMemberId ||
    !run.sponsorRole
  )
    return null;
  const [user, membership, project] = await Promise.all([
    AuthRepository.getHostedUser(run.sponsorUserId),
    ContentRepository.getMembership(run.organizationId, run.sponsorUserId),
    ProjectRepository.getProjectForOrganization(
      run.projectId,
      run.organizationId,
    ),
  ]);
  if (
    !user ||
    !membership ||
    !project ||
    membership.id !== run.sponsorMemberId ||
    membership.role !== run.sponsorRole
  )
    return null;
  if (!["web", "mcp", "sam"].includes(run.surface)) return null;
  const actor: CompetitorResearchActor = {
    userId: user.id,
    userEmail: user.email,
    organizationId: run.organizationId,
    role: membership.role,
    surface:
      run.surface === "mcp" ? "mcp" : run.surface === "sam" ? "sam" : "web",
  };
  return {
    run,
    scope: {
      actor,
      memberId: membership.id,
      requireMembership: true,
    } satisfies CompetitorResearchScope,
  };
}

async function getBillingContext(runId: string, billingToken: string) {
  const [row] = await db
    .select({ run: runs })
    .from(runs)
    .innerJoin(
      projects,
      and(
        eq(projects.id, runs.projectId),
        eq(projects.organizationId, runs.organizationId),
      ),
    )
    .where(
      and(
        eq(runs.id, runId),
        eq(runs.billingToken, billingToken),
        eq(runs.billingState, "started"),
        eq(runs.state, "finished"),
        eq(runs.origin, "explicit"),
        isNull(runs.redactedAtMs),
        sql`exists (select 1 from project_competitor_research_operations o where o.run_id=${runId} and o.project_id=${runs.projectId} and o.cost_usd > 0)`,
      ),
    )
    .limit(1);
  const run = row?.run;
  if (!run?.sponsorUserId || !run.sponsorMemberId || !run.sponsorRole)
    return null;
  const user = await AuthRepository.getHostedUser(run.sponsorUserId);
  if (!user) return null;
  return {
    userId: user.id,
    userEmail: user.email,
    organizationId: run.organizationId,
    projectId: run.projectId,
  };
}

export const CompetitorResearchRepository = {
  getSnapshot,
  getAuthority,
  getBillingContext,
  getRun,
  listRecent,
  getSetupRunByRequest,
  admit,
  admitSetup,
  claimBilling,
  recordBilling,
  recordOperationFailure,
  finish,
  issueOperation,
  prepareOperation,
  recordSearch,
  recordPage,
  recordClassification,
  accept,
  recordSetupEvidence,
  recordSetupSettlement,
  redactSponsor: (userId: string, nowMs: number) =>
    runBatch((tx) =>
      competitorResearchPrivacyQueries(
        tx,
        privacySchema,
        userId,
        nowMs,
        crypto.randomUUID(),
      ),
    ),
} as const;
