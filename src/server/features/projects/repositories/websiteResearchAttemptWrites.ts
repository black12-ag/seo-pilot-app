import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { runBatch } from "@/db/runBatch";
import { projectWebsiteResearchAttempts as attempts } from "@/db/schema";
import {
  lockAuthorityOrganization,
  lockProject,
} from "@/server/features/site-authority/repositories/siteAuthorityProjectWrites";
import { lockScheduleSponsor } from "@/server/features/audit/repositories/auditScheduleProjectWrites";
import { normalizeBacklinksTarget } from "@/server/lib/dataforseoBacklinksTarget";
import { sha256Hex } from "@/server/lib/audit/ids";
import { AppError } from "@/server/lib/errors";
import {
  websiteResearchSchema,
  type WebsiteResearch,
} from "@/types/schemas/projectWebsite";

type Attempt = typeof attempts.$inferSelect;
function currentAuthority(row: Attempt, nowMs: number) {
  return sql`exists (select 1 from projects p join member m on m.organization_id=p.organization_id
    where p.id=${row.projectId} and p.organization_id=${row.organizationId} and p.archived_at is null
    and coalesce(p.domain,'')=coalesce(${row.snapshotDomain},'')
    and p.location_code=${row.locationCode} and p.language_code=${row.languageCode}
    and coalesce((select s.context_version from content_project_state s where s.project_id=p.id),0)=${row.contextVersion}
    and m.id=${row.sponsorMemberId} and m.user_id=${row.sponsorUserId} and m.role=${row.sponsorRole}
    and ${row.deadlineAtMs}>${nowMs}
    and exists (select 1 from project_website_research_attempts a where a.id=${row.id} and a.redacted_at_ms is null and coalesce(a.reason,'')<>'restored'))`;
}

export function locks(
  tx: Parameters<Parameters<typeof runBatch>[0]>[0],
  row: Attempt,
) {
  return [
    lockAuthorityOrganization(tx, row.organizationId),
    lockProject(tx, row.projectId, row.organizationId),
    lockScheduleSponsor(tx, row.sponsorUserId, row.organizationId),
  ];
}

async function claimExecution(
  row: Attempt,
  admissionToken: string,
  nowMs: number,
) {
  const id = row.id;
  if (
    row.admissionToken !== admissionToken ||
    row.state !== "admitted" ||
    row.redactedAtMs !== null
  )
    return { kind: "blocked" } as const;
  const executionToken = crypto.randomUUID();
  await runBatch((tx) => [
    ...locks(tx, row),
    tx
      .update(attempts)
      .set({ state: "running", executionToken, startedAtMs: nowMs })
      .where(
        and(
          eq(attempts.id, id),
          eq(attempts.state, "admitted"),
          eq(attempts.admissionToken, admissionToken),
          currentAuthority(row, nowMs),
        ),
      ),
  ]);
  const [current] = await db
    .select()
    .from(attempts)
    .where(eq(attempts.id, id))
    .limit(1);
  return current?.executionToken === executionToken
    ? ({ kind: "claimed", executionToken } as const)
    : ({ kind: "blocked" } as const);
}

async function linkCompetitorRun(
  row: Attempt,
  executionToken: string,
  runId: string,
  nowMs: number,
) {
  const id = row.id;
  if (
    row.state !== "running" ||
    row.executionToken !== executionToken ||
    row.competitorRunId
  )
    return { kind: "blocked" } as const;
  const runGuard = sql`exists (select 1 from project_competitor_research_runs r where r.id=${runId} and r.project_id=${row.projectId} and r.organization_id=${row.organizationId} and r.origin='setup' and r.request_id=${id} and r.sponsor_user_id=${row.sponsorUserId} and r.sponsor_member_id=${row.sponsorMemberId} and r.sponsor_role=${row.sponsorRole} and r.surface=${row.surface} and coalesce(r.domain,'')=coalesce(${row.snapshotDomain},'') and r.location_code=${row.locationCode} and r.language_code=${row.languageCode} and r.context_version=${row.contextVersion} and r.context_hash=${row.contextHash} and r.redacted_at_ms is null and r.state in ('queued','running') and r.deadline_at_ms>${nowMs})`;
  await runBatch((tx) => [
    ...locks(tx, row),
    tx
      .update(attempts)
      .set({ competitorRunId: runId })
      .where(
        and(
          eq(attempts.id, id),
          eq(attempts.state, "running"),
          eq(attempts.executionToken, executionToken),
          currentAuthority(row, nowMs),
          runGuard,
        ),
      ),
  ]);
  const [current] = await db
    .select({ runId: attempts.competitorRunId })
    .from(attempts)
    .where(eq(attempts.id, id))
    .limit(1);
  return current?.runId === runId
    ? ({ kind: "linked" } as const)
    : ({ kind: "blocked" } as const);
}

async function complete(
  row: Attempt,
  executionToken: string,
  review: WebsiteResearch,
  nowMs: number,
) {
  const id = row.id;
  const parsed = websiteResearchSchema.parse(review);
  if (
    parsed.domain !== (row.snapshotDomain ?? row.requestedDomain) ||
    normalizeBacklinksTarget(parsed.domain, { scope: "domain" }).apiTarget !==
      parsed.domain
  )
    throw new AppError("VALIDATION_ERROR");
  const json = JSON.stringify(parsed);
  if (new TextEncoder().encode(json).byteLength > 65536)
    throw new AppError("VALIDATION_ERROR");
  const hash = await sha256Hex(json);
  if (row.state === "review_ready")
    return row.executionToken === executionToken && row.reviewHash === hash
      ? ({ kind: "replayed" } as const)
      : ({ kind: "conflict" } as const);
  if (
    row.state !== "running" ||
    row.executionToken !== executionToken ||
    row.redactedAtMs !== null
  )
    return { kind: "blocked" } as const;
  await runBatch((tx) => [
    ...locks(tx, row),
    tx
      .update(attempts)
      .set({
        state: "review_ready",
        activeProjectId: null,
        finishedAtMs: nowMs,
        reviewSnapshotJson: json,
        reviewHash: hash,
      })
      .where(
        and(
          eq(attempts.id, id),
          eq(attempts.state, "running"),
          eq(attempts.executionToken, executionToken),
          currentAuthority(row, nowMs),
        ),
      ),
  ]);
  const [current] = await db
    .select()
    .from(attempts)
    .where(eq(attempts.id, id))
    .limit(1);
  return current?.state === "review_ready" && current.reviewHash === hash
    ? ({ kind: "stored" } as const)
    : ({ kind: "blocked" } as const);
}

async function finish(
  id: string,
  proof: { admissionToken: string } | { executionToken: string },
  state: "failed" | "unknown" | "finished_no_review",
  reason: string,
  nowMs: number,
) {
  const [row] = await db
    .select()
    .from(attempts)
    .where(eq(attempts.id, id))
    .limit(1);
  if (
    !row ||
    row.redactedAtMs !== null ||
    !Number.isSafeInteger(nowMs) ||
    nowMs < row.createdAtMs ||
    reason.length > 200 ||
    reason === "restored"
  )
    return { kind: "blocked" } as const;
  const matching =
    row.state === "admitted"
      ? "admissionToken" in proof && row.admissionToken === proof.admissionToken
      : row.state === "running"
        ? "executionToken" in proof &&
          row.executionToken === proof.executionToken
        : false;
  if (!matching || (state === "finished_no_review" && row.state !== "running"))
    return { kind: "blocked" } as const;
  await runBatch((tx) => [
    ...locks(tx, row),
    tx
      .update(attempts)
      .set({ state, activeProjectId: null, finishedAtMs: nowMs, reason })
      .where(
        and(
          eq(attempts.id, id),
          eq(attempts.state, row.state),
          isNull(attempts.redactedAtMs),
          eq(
            row.state === "admitted"
              ? attempts.admissionToken
              : attempts.executionToken,
            "admissionToken" in proof
              ? proof.admissionToken
              : proof.executionToken,
          ),
        ),
      ),
  ]);
  const [current] = await db
    .select()
    .from(attempts)
    .where(eq(attempts.id, id))
    .limit(1);
  return current?.state === state
    ? ({ kind: "finished" } as const)
    : ({ kind: "blocked" } as const);
}

export { claimExecution, linkCompetitorRun, complete, finish };
