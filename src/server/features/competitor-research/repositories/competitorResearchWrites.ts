import { ContentRepository } from "@/server/features/content/repositories/ContentRepository";
import { ProjectRepository } from "@/server/features/projects/repositories/ProjectRepository";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { runBatch } from "@/db/runBatch";
import {
  projectCompetitorResearchRuns as runs,
  projectCompetitorResearchOperations as operations,
} from "@/db/schema";
import {
  lockAuthorityOrganization,
  lockProject,
} from "@/server/features/site-authority/repositories/siteAuthorityProjectWrites";
import { lockScheduleSponsor } from "@/server/features/audit/repositories/auditScheduleProjectWrites";
import { AppError } from "@/server/lib/errors";
import type {
  CompetitorResearchSnapshot,
  StartCompetitorResearchInput,
} from "@/types/schemas/competitorResearch";
import { competitorResearchReasonSchema } from "@/types/schemas/competitorResearch";
import type { z } from "zod";
import type { CompetitorResearchScope } from "./CompetitorResearchRepository";

type AdmitInput = {
  id: string;
  input: StartCompetitorResearchInput;
  requestHash: string;
  snapshot: CompetitorResearchSnapshot;
  businessSummary: string;
  blockedReason: z.infer<typeof competitorResearchReasonSchema> | null;
  modelBackendId: string | null;
  modelConfigurationHash: string;
  nowMs: number;
};

type SetupAdmitInput = Omit<AdmitInput, "input" | "blockedReason"> & {
  projectId: string;
  requestId: string;
  deadlineAtMs: number;
};
type Admission = {
  id: string;
  projectId: string;
  requestId: string;
  requestHash: string;
  snapshot: CompetitorResearchSnapshot;
  businessSummary: string;
  blockedReason: z.infer<typeof competitorResearchReasonSchema> | null;
  modelBackendId: string | null;
  modelConfigurationHash: string;
  nowMs: number;
  deadlineAtMs: number;
  origin: "explicit" | "setup";
};

async function writeAdmission(scope: CompetitorResearchScope, data: Admission) {
  const { actor, memberId } = scope;
  const { projectId, requestId, snapshot, id, nowMs } = data;
  const authorize = async () => {
    const [project, member] = await Promise.all([
      ProjectRepository.getProjectForOrganization(
        projectId,
        actor.organizationId,
      ),
      ContentRepository.getMembership(actor.organizationId, actor.userId),
    ]);
    if (!project) throw new AppError("NOT_FOUND");
    if (!member || member.id !== memberId || member.role !== actor.role)
      throw new AppError("FORBIDDEN");
  };
  if (
    !scope.requireMembership ||
    !memberId ||
    !actor.userId ||
    !actor.organizationId
  )
    throw new AppError("FORBIDDEN");
  if (
    new TextEncoder().encode(data.businessSummary).byteLength > 6000 ||
    (data.blockedReason &&
      !competitorResearchReasonSchema.safeParse(data.blockedReason).success)
  )
    throw new AppError("VALIDATION_ERROR");
  await authorize();
  const authority = sql`exists (select 1 from projects p join member m on m.organization_id = p.organization_id
    where p.id = ${projectId} and p.organization_id = ${actor.organizationId} and p.archived_at is null
    and coalesce(p.domain,'') = coalesce(${snapshot.domain},'') and p.location_code = ${snapshot.locationCode} and p.language_code = ${snapshot.languageCode}
    and coalesce((select s.context_version from content_project_state s where s.project_id = p.id),0) = ${snapshot.contextVersion}
    and m.id = ${memberId} and m.user_id = ${actor.userId} and m.role = ${actor.role})`;
  const blocked = data.blockedReason !== null;
  const slots = [
    ["own_page", "page"],
    ["search_0", "search"],
    ["search_1", "search"],
    ["classify", "model"],
  ] as const;
  const slotIds = slots.map(() => crypto.randomUUID());
  const admissionToken = crypto.randomUUID();
  const [before] = await db
    .select()
    .from(runs)
    .where(and(eq(runs.projectId, projectId), eq(runs.requestId, requestId)))
    .limit(1);
  if (before) {
    if (before.redactedAtMs !== null)
      return { kind: "privacy_erased", runId: before.id } as const;
    if (before.reason === "restored")
      return { kind: "conflict", runId: before.id } as const;
    if (
      before.requestHash === data.requestHash &&
      before.sponsorUserId === actor.userId &&
      before.sponsorMemberId === memberId &&
      before.sponsorRole === actor.role &&
      before.origin === data.origin
    )
      return { kind: "replayed", runId: before.id } as const;
    return { kind: "conflict", runId: before.id } as const;
  }
  await runBatch((tx) => [
    lockAuthorityOrganization(tx, actor.organizationId),
    lockProject(tx, projectId, actor.organizationId),
    lockScheduleSponsor(tx, actor.userId, actor.organizationId),
    tx
      .insert(runs)
      .select(
        sql`select ${id}, ${projectId}, ${actor.organizationId}, ${admissionToken}, ${requestId}, ${data.requestHash}, ${data.origin}, ${blocked ? "finished" : "queued"}, ${blocked ? "blocked" : null}, ${data.blockedReason}, ${blocked ? null : projectId}, ${actor.userId}, ${memberId}, ${actor.role}, ${actor.surface}, ${data.modelBackendId}, ${data.modelConfigurationHash}, ${snapshot.domain}, ${snapshot.locationCode}, ${snapshot.languageCode}, ${snapshot.contextVersion}, ${snapshot.contextHash}, ${data.businessSummary}, null, null, null, ${data.origin === "explicit" ? "competitor-discovery-v1" : null}, ${nowMs}, null, ${data.deadlineAtMs}, ${blocked ? nowMs : null}, null, null, null, 'not_started', null, null, null, null, null, null, null where ${authority}`,
      )
      .onConflictDoNothing(),
    ...(!blocked && data.origin === "explicit"
      ? slots.map(([slot, kind], i) =>
          tx
            .insert(operations)
            .select(
              sql`select ${slotIds[i]}, ${projectId}, ${id}, ${slot}, ${kind}, 'prepared', null, null, null, null, null, null, null, null, null, null, null, 'unknown', null, null, null where ${authority} and exists (select 1 from project_competitor_research_runs r where r.id = ${id} and r.project_id = ${projectId} and r.redacted_at_ms is null and r.state = 'queued')`,
            )
            .onConflictDoNothing(),
        )
      : []),
  ]);
  const [receipt] = await db
    .select()
    .from(runs)
    .where(and(eq(runs.projectId, projectId), eq(runs.requestId, requestId)))
    .limit(1);
  await authorize();
  if (receipt) {
    if (receipt.redactedAtMs !== null)
      return { kind: "privacy_erased", runId: receipt.id } as const;
    if (receipt.reason === "restored")
      return { kind: "conflict", runId: receipt.id } as const;
    if (receipt.admissionToken === admissionToken)
      return { kind: "created", runId: id } as const;
    if (
      receipt.requestHash === data.requestHash &&
      receipt.sponsorUserId === actor.userId &&
      receipt.sponsorMemberId === memberId &&
      receipt.sponsorRole === actor.role &&
      receipt.origin === data.origin
    )
      return { kind: "replayed", runId: receipt.id } as const;
    return { kind: "conflict", runId: receipt.id } as const;
  }
  const [active] = await db
    .select({ id: runs.id })
    .from(runs)
    .where(eq(runs.activeProjectId, projectId))
    .limit(1);
  return active
    ? ({ kind: "busy", runId: active.id } as const)
    : ({ kind: "conflict", runId: null } as const);
}
async function admit(scope: CompetitorResearchScope, data: AdmitInput) {
  if (
    data.snapshot.contextVersion !== data.input.expectedContextVersion ||
    data.snapshot.contextHash !== data.input.contextHash
  )
    throw new AppError("VALIDATION_ERROR");
  return writeAdmission(scope, {
    ...data,
    projectId: data.input.projectId,
    requestId: data.input.requestId,
    origin: "explicit",
    deadlineAtMs: data.nowMs + 240000,
  });
}
async function admitSetup(
  scope: CompetitorResearchScope,
  data: SetupAdmitInput,
) {
  if (data.deadlineAtMs <= data.nowMs) throw new AppError("VALIDATION_ERROR");
  return writeAdmission(scope, {
    ...data,
    origin: "setup",
    blockedReason: null,
  });
}
export { admit, admitSetup };
