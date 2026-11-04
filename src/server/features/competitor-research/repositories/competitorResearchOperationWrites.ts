import { competitorResearchReasonSchema } from "@/types/schemas/competitorResearch";
import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { runBatch } from "@/db/runBatch";
import {
  projectCompetitorResearchOperations as operations,
  projectCompetitorResearchRuns as runs,
} from "@/db/schema";
import {
  lockAuthorityOrganization,
  lockProject,
} from "@/server/features/site-authority/repositories/siteAuthorityProjectWrites";
import { lockScheduleSponsor } from "@/server/features/audit/repositories/auditScheduleProjectWrites";

type Run = typeof runs.$inferSelect;
type Slot =
  | "own_page"
  | "search_0"
  | "search_1"
  | "page_0"
  | "page_1"
  | "page_2"
  | "page_3"
  | "page_4"
  | "classify";
type Input = {
  inputHash: string;
  queryText: string | null;
  targetUrl: string | null;
};

function currentAuthority(run: Run, nowMs: number) {
  return sql`exists (select 1 from project_competitor_research_runs r
    join projects p on p.id = r.project_id
    where r.id = ${run.id} and r.project_id = ${run.projectId}
      and r.organization_id = ${run.organizationId} and p.organization_id = r.organization_id
      and p.archived_at is null and coalesce(p.domain,'') = coalesce(r.domain,'')
      and p.location_code = r.location_code and p.language_code = r.language_code
      and coalesce((select s.context_version from content_project_state s where s.project_id = p.id),0) = r.context_version
      and r.state in ('queued','running') and r.active_project_id = p.id
      and r.revoked_at_ms is null and r.redacted_at_ms is null and r.deadline_at_ms > ${nowMs}
      and exists (select 1 from member m where m.id = r.sponsor_member_id and m.user_id = r.sponsor_user_id
        and m.organization_id = r.organization_id and m.role = r.sponsor_role))`;
}

async function find(runId: string, slot: Slot) {
  const [run] = await db.select().from(runs).where(eq(runs.id, runId)).limit(1);
  if (!run) return null;
  const [operation] = await db
    .select()
    .from(operations)
    .where(and(eq(operations.runId, runId), eq(operations.slot, slot)))
    .limit(1);
  return operation ? { run, operation } : null;
}

function locks(tx: Parameters<Parameters<typeof runBatch>[0]>[0], run: Run) {
  return [
    lockAuthorityOrganization(tx, run.organizationId),
    lockProject(tx, run.projectId, run.organizationId),
    lockScheduleSponsor(tx, run.sponsorUserId, run.organizationId),
  ];
}

async function prepareOperation(
  runId: string,
  slot: Slot,
  input: Input,
  nowMs: number,
) {
  if (
    !/^[a-f0-9]{64}$/.test(input.inputHash) ||
    (input.queryText !== null && input.queryText.length > 200) ||
    (input.targetUrl !== null && input.targetUrl.length > 2048)
  )
    return { kind: "conflict" } as const;
  const found = await find(runId, slot);
  if (!found) return { kind: "blocked" } as const;
  const { run, operation } = found;
  if (slot.startsWith("page_") && (!operation.candidateId || !input.targetUrl))
    return { kind: "blocked" } as const;
  const targetGuard = slot.startsWith("page_")
    ? sql`exists (select 1 from project_competitor_research_candidates c where c.id=${operation.candidateId} and c.run_id=${runId} and c.project_id=${run.projectId} and c.requested_url=${input.targetUrl})`
    : sql`true`;
  await runBatch((tx) => [
    ...locks(tx, run),
    tx
      .update(operations)
      .set({
        inputHash: input.inputHash,
        queryText: input.queryText,
        targetUrl: input.targetUrl,
      })
      .where(
        and(
          eq(operations.id, operation.id),
          eq(operations.runId, runId),
          eq(operations.state, "prepared"),
          isNull(operations.inputHash),
          targetGuard,
          currentAuthority(run, nowMs),
        ),
      ),
  ]);
  const current = await find(runId, slot);
  if (!current || current.operation.state !== "prepared")
    return { kind: "blocked" } as const;
  if (
    current.operation.inputHash !== input.inputHash ||
    current.operation.queryText !== input.queryText ||
    current.operation.targetUrl !== input.targetUrl
  )
    return { kind: "conflict" } as const;
  const [authorized] = await db
    .select({ id: operations.id })
    .from(operations)
    .where(
      and(
        eq(operations.id, operation.id),
        eq(operations.state, "prepared"),
        eq(operations.inputHash, input.inputHash),
        targetGuard,
        currentAuthority(run, nowMs),
      ),
    )
    .limit(1);
  return authorized
    ? ({ kind: "prepared" } as const)
    : ({ kind: "blocked" } as const);
}

async function issueOperation(
  runId: string,
  slot: Slot,
  nowMs: number,
  currentModelConfigurationHash: string,
) {
  const found = await find(runId, slot);
  if (!found) return { kind: "blocked" } as const;
  const { run, operation } = found;
  if (run.redactedAtMs !== null) return { kind: "blocked" } as const;
  if (operation.state === "succeeded" || operation.state === "failed")
    return { kind: "stored" } as const;
  if (operation.state === "issued" || operation.state === "unknown")
    return { kind: "uncertain" } as const;
  if (
    !operation.inputHash ||
    run.modelConfigurationHash !== currentModelConfigurationHash
  )
    return { kind: "blocked" } as const;
  const issueToken = crypto.randomUUID();
  await runBatch((tx) => [
    ...locks(tx, run),
    tx
      .update(operations)
      .set({ state: "issued", issueToken, issuedAtMs: nowMs })
      .where(
        and(
          eq(operations.id, operation.id),
          eq(operations.state, "prepared"),
          eq(operations.inputHash, operation.inputHash!),
          currentAuthority(run, nowMs),
          sql`not exists (select 1 from project_competitor_research_operations other where other.run_id=${runId} and other.id<>${operation.id} and other.state in ('issued','unknown'))`,
          sql`exists (select 1 from project_competitor_research_runs r where r.id = ${runId} and r.model_configuration_hash = ${currentModelConfigurationHash})`,
        ),
      ),
  ]);
  const current = await find(runId, slot);
  if (
    current?.operation.state === "issued" &&
    current.operation.issueToken === issueToken
  )
    return { kind: "issued", issueToken } as const;
  if (
    current?.operation.state === "issued" ||
    current?.operation.state === "unknown"
  )
    return { kind: "uncertain" } as const;
  if (
    current?.operation.state === "succeeded" ||
    current?.operation.state === "failed"
  )
    return { kind: "stored" } as const;
  return { kind: "blocked" } as const;
}

async function finish(
  runId: string,
  outcome:
    | "complete"
    | "partial"
    | "unavailable"
    | "failed"
    | "blocked"
    | "unknown",
  reason: string | null,
  nowMs: number,
) {
  if (
    reason !== null &&
    !competitorResearchReasonSchema.safeParse(reason).success
  )
    return { kind: "blocked" } as const;
  const [run] = await db.select().from(runs).where(eq(runs.id, runId)).limit(1);
  if (!run) return { kind: "blocked" } as const;
  await runBatch((tx) => [
    ...locks(tx, run),
    tx
      .update(runs)
      .set({
        state: "finished",
        outcome,
        reason,
        finishedAtMs: nowMs,
        activeProjectId: null,
        revokedAtMs: nowMs,
      })
      .where(
        and(
          eq(runs.id, runId),
          isNull(runs.redactedAtMs),
          sql`${runs.state} in ('queued','running') and (${outcome === "unknown" ? 1 : 0} = 1 or not exists (select 1 from project_competitor_research_operations o where o.run_id=${runId} and o.state in ('issued','unknown')))`,
        ),
      ),
  ]);
  const [current] = await db
    .select()
    .from(runs)
    .where(eq(runs.id, runId))
    .limit(1);
  if (
    current?.state === "finished" &&
    current.redactedAtMs === null &&
    current.outcome === outcome &&
    current.reason === reason
  )
    return { kind: "finished" } as const;
  return { kind: "blocked" } as const;
}

async function claimBilling(runId: string, _nowMs: number) {
  const [run] = await db.select().from(runs).where(eq(runs.id, runId)).limit(1);
  if (!run || run.redactedAtMs !== null || run.state !== "finished")
    return { kind: "blocked" } as const;
  const token = crypto.randomUUID();
  await runBatch((tx) => [
    ...locks(tx, run),
    tx
      .update(runs)
      .set({ billingState: "started", billingToken: token })
      .where(
        and(
          eq(runs.id, runId),
          eq(runs.billingState, "not_started"),
          eq(runs.state, "finished"),
          isNull(runs.redactedAtMs),
          sql`exists (select 1 from project_competitor_research_operations o where o.run_id=${runId} and o.project_id=${run.projectId} and o.cost_usd > 0)`,
        ),
      ),
  ]);
  const [after] = await db
    .select()
    .from(runs)
    .where(eq(runs.id, runId))
    .limit(1);
  if (!after || after.redactedAtMs !== null)
    return { kind: "blocked" } as const;
  if (after.billingState === "not_started")
    return { kind: "not_required" } as const;
  if (after.billingState === "started" && after.billingToken === token) {
    const spend = await db
      .select()
      .from(operations)
      .where(
        and(
          eq(operations.runId, runId),
          eq(operations.projectId, run.projectId),
          sql`${operations.costUsd} > 0`,
        ),
      );
    return { kind: "claimed", billingToken: token, spend } as const;
  }
  return { kind: "existing", state: after.billingState } as const;
}
async function recordBilling(
  runId: string,
  token: string,
  result: "submitted" | "selfhost_external" | "unknown",
) {
  const [run] = await db.select().from(runs).where(eq(runs.id, runId)).limit(1);
  if (!run || run.redactedAtMs !== null) return { kind: "blocked" } as const;
  await runBatch((tx) => [
    ...locks(tx, run),
    tx
      .update(runs)
      .set({ billingState: result })
      .where(
        and(
          eq(runs.id, runId),
          eq(runs.billingState, "started"),
          eq(runs.billingToken, token),
          isNull(runs.redactedAtMs),
        ),
      ),
  ]);
  const [after] = await db
    .select()
    .from(runs)
    .where(eq(runs.id, runId))
    .limit(1);
  return after?.redactedAtMs === null &&
    after.billingToken === token &&
    after.billingState === result
    ? ({ kind: "stored" } as const)
    : ({ kind: "blocked" } as const);
}
async function recordOperationFailure(
  runId: string,
  slot: Slot,
  issueToken: string,
  input: {
    outcome: "failed" | "unknown";
    reason: string;
    billing: {
      costUsd: number;
      provider: "dataforseo" | "openrouter" | "owner_worker" | "public_fetch";
      providerTaskId: string | null;
    } | null;
  },
  nowMs: number,
) {
  if (
    !["failed", "unknown"].includes(input.outcome) ||
    (input.billing !== null &&
      !["dataforseo", "openrouter", "owner_worker", "public_fetch"].includes(
        input.billing.provider,
      )) ||
    !competitorResearchReasonSchema.safeParse(input.reason).success ||
    (input.billing !== null &&
      (!Number.isFinite(input.billing.costUsd) ||
        input.billing.costUsd < 0 ||
        (input.billing.providerTaskId?.length ?? 0) > 160))
  )
    return { kind: "blocked" } as const;
  const found = await find(runId, slot);
  if (!found || found.run.redactedAtMs !== null)
    return { kind: "blocked" } as const;
  const { run, operation } = found;
  await runBatch((tx) => [
    ...locks(tx, run),
    tx
      .update(operations)
      .set({
        state: input.outcome,
        reason: input.reason,
        finishedAtMs: nowMs,
        costUsd: input.billing?.costUsd ?? null,
        usageBasis: input.billing ? "usd" : "unknown",
        provider: input.billing?.provider ?? null,
        providerTaskId: input.billing?.providerTaskId ?? null,
      })
      .where(
        and(
          eq(operations.id, operation.id),
          eq(operations.state, "issued"),
          eq(operations.issueToken, issueToken),
          currentAuthority(run, nowMs),
        ),
      ),
  ]);
  const [after] = await db
    .select()
    .from(operations)
    .where(
      and(
        eq(operations.id, operation.id),
        eq(operations.runId, runId),
        currentAuthority(run, nowMs),
      ),
    )
    .limit(1);
  return after?.state === input.outcome &&
    after.issueToken === issueToken &&
    after.reason === input.reason &&
    after.costUsd === (input.billing?.costUsd ?? null) &&
    after.provider === (input.billing?.provider ?? null) &&
    after.providerTaskId === (input.billing?.providerTaskId ?? null)
    ? ({ kind: "stored" } as const)
    : ({ kind: "blocked" } as const);
}

export {
  prepareOperation,
  issueOperation,
  finish,
  claimBilling,
  recordBilling,
  recordOperationFailure,
  currentAuthority,
  locks,
};
