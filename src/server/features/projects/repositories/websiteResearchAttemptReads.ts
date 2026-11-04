import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { projectWebsiteResearchAttempts as attempts } from "@/db/schema";
import { AuthRepository } from "@/server/auth/repositories/AuthRepository";
import { ContentRepository } from "@/server/features/content/repositories/ContentRepository";
import {
  CompetitorResearchRepository,
  type CompetitorResearchScope,
} from "@/server/features/competitor-research/repositories/CompetitorResearchRepository";
import { ProjectRepository } from "./ProjectRepository";
import { AppError } from "@/server/lib/errors";
import type { CompetitorResearchActor } from "@/types/schemas/competitorResearch";

function liveOriginalSponsor(
  scope: CompetitorResearchScope,
  projectId: string,
) {
  return sql`exists (select 1 from projects p join member m on m.organization_id=p.organization_id
    where p.id=${projectId} and p.id=${attempts.projectId}
      and p.organization_id=${scope.actor.organizationId} and p.organization_id=${attempts.organizationId}
      and p.archived_at is null and m.id=${attempts.sponsorMemberId}
      and m.user_id=${attempts.sponsorUserId} and m.role=${attempts.sponsorRole})`;
}

export async function authorizeProject(
  scope: CompetitorResearchScope,
  projectId: string,
) {
  if (
    !scope.requireMembership ||
    !scope.memberId ||
    !scope.actor.userId ||
    !scope.actor.organizationId
  )
    throw new AppError("FORBIDDEN");
  const [project, member] = await Promise.all([
    ProjectRepository.getProjectForOrganization(
      projectId,
      scope.actor.organizationId,
    ),
    ContentRepository.getMembership(
      scope.actor.organizationId,
      scope.actor.userId,
    ),
  ]);
  if (!project) throw new AppError("NOT_FOUND");
  if (
    !member ||
    member.id !== scope.memberId ||
    member.role !== scope.actor.role
  )
    throw new AppError("FORBIDDEN");
}

export async function scoped(
  scope: CompetitorResearchScope,
  projectId: string,
  id: string,
) {
  await authorizeProject(scope, projectId);
  if (!scope.memberId) throw new AppError("FORBIDDEN");
  const [row] = await db
    .select()
    .from(attempts)
    .where(
      and(
        eq(attempts.id, id),
        eq(attempts.projectId, projectId),
        eq(attempts.organizationId, scope.actor.organizationId),
        eq(attempts.sponsorUserId, scope.actor.userId),
        eq(attempts.sponsorMemberId, scope.memberId),
        eq(attempts.sponsorRole, scope.actor.role),
        liveOriginalSponsor(scope, projectId),
      ),
    )
    .limit(1);
  if (
    !row ||
    row.sponsorUserId !== scope.actor.userId ||
    row.sponsorMemberId !== scope.memberId ||
    row.sponsorRole !== scope.actor.role
  )
    throw new AppError("NOT_FOUND");
  return row;
}

/** System read for the lock holder, used only to release an expired attempt. */
export async function getActive(projectId: string) {
  const [row] = await db
    .select()
    .from(attempts)
    .where(eq(attempts.activeProjectId, projectId))
    .limit(1);
  return row ?? null;
}

export async function get(
  scope: CompetitorResearchScope,
  projectId: string,
  id: string,
) {
  return scoped(scope, projectId, id);
}

/** Read an exact receipt before a legacy Workflow gate without creating work. */
export async function lookupExistingForStart(
  scope: CompetitorResearchScope,
  projectId: string,
  id: string,
) {
  await authorizeProject(scope, projectId);
  if (!scope.requireMembership || !scope.memberId)
    throw new AppError("FORBIDDEN");
  const liveActor = sql`exists (select 1 from projects p join member m on m.organization_id=p.organization_id
    where p.id=${projectId} and p.organization_id=${scope.actor.organizationId} and p.archived_at is null
      and m.id=${scope.memberId} and m.user_id=${scope.actor.userId} and m.role=${scope.actor.role})`;
  const [row] = await db
    .select()
    .from(attempts)
    .where(
      and(
        eq(attempts.id, id),
        eq(attempts.projectId, projectId),
        eq(attempts.organizationId, scope.actor.organizationId),
        liveActor,
      ),
    )
    .limit(1);
  if (!row) return { kind: "missing" } as const;
  if (row.redactedAtMs !== null)
    return { kind: "privacy_erased", attemptId: id } as const;
  if (row.reason === "restored") return { kind: "restored" } as const;
  if (
    row.sponsorUserId !== scope.actor.userId ||
    row.sponsorMemberId !== scope.memberId ||
    row.sponsorRole !== scope.actor.role
  )
    return { kind: "missing" } as const;
  return { kind: "receipt", row } as const;
}

export async function getLatestAi(
  scope: CompetitorResearchScope,
  projectId: string,
) {
  await authorizeProject(scope, projectId);
  if (!scope.memberId) throw new AppError("FORBIDDEN");
  const [row] = await db
    .select()
    .from(attempts)
    .where(
      and(
        eq(attempts.projectId, projectId),
        eq(attempts.organizationId, scope.actor.organizationId),
        eq(attempts.mode, "ai_setup"),
        eq(attempts.sponsorUserId, scope.actor.userId),
        eq(attempts.sponsorMemberId, scope.memberId),
        eq(attempts.sponsorRole, scope.actor.role),
        liveOriginalSponsor(scope, projectId),
      ),
    )
    .orderBy(desc(attempts.createdAtMs), desc(attempts.id))
    .limit(1);
  return row ?? null;
}

export async function getAuthority(id: string, nowMs: number) {
  const [row] = await db
    .select()
    .from(attempts)
    .where(eq(attempts.id, id))
    .limit(1);
  if (
    !row ||
    !row.sponsorUserId ||
    !row.sponsorMemberId ||
    !row.sponsorRole ||
    row.redactedAtMs !== null ||
    row.deadlineAtMs <= nowMs ||
    !["admitted", "running"].includes(row.state)
  )
    return null;
  const [user, member, project] = await Promise.all([
    AuthRepository.getHostedUser(row.sponsorUserId),
    ContentRepository.getMembership(row.organizationId, row.sponsorUserId),
    ProjectRepository.getProjectForOrganization(
      row.projectId,
      row.organizationId,
    ),
  ]);
  if (
    !user ||
    !member ||
    !project ||
    member.id !== row.sponsorMemberId ||
    member.role !== row.sponsorRole ||
    project.domain !== row.snapshotDomain ||
    project.locationCode !== row.locationCode ||
    project.languageCode !== row.languageCode
  )
    return null;
  const actor: CompetitorResearchActor = {
    userId: user.id,
    userEmail: user.email,
    organizationId: row.organizationId,
    role: member.role,
    surface:
      row.surface === "mcp" ? "mcp" : row.surface === "sam" ? "sam" : "web",
  };
  const snapshot = await CompetitorResearchRepository.getSnapshot(
    actor,
    row.projectId,
  ).catch((error: unknown) => {
    // A failed read says nothing about authority, so it must not end the attempt.
    if (
      error instanceof AppError &&
      ["FORBIDDEN", "NOT_FOUND", "UNAUTHENTICATED"].includes(error.code)
    )
      return null;
    throw error;
  });
  if (
    !snapshot ||
    snapshot.snapshot.contextVersion !== row.contextVersion ||
    snapshot.snapshot.contextHash !== row.contextHash
  )
    return null;
  return {
    row,
    scope: {
      actor,
      memberId: member.id,
      requireMembership: true,
    } satisfies CompetitorResearchScope,
  };
}
