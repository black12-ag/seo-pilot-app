import { env } from "cloudflare:workers";
import { sort } from "remeda";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { projectCompetitorResearchRuns as runs } from "@/db/schema";
import { CompetitorResearchRepository as repository } from "../repositories/CompetitorResearchRepository";
import { sha256Hex } from "@/server/lib/audit/ids";
import { truncateToBytes } from "@/server/lib/audit/html-response";
import { AppError } from "@/server/lib/errors";
import { startWorkflow } from "@/server/lib/startWorkflow";
import {
  acceptCompetitorResearchInputSchema,
  competitorResearchReadResultSchema,
  competitorResearchStateSchema,
  getCompetitorResearchRunInputSchema,
  startCompetitorResearchInputSchema,
  type AcceptCompetitorResearchInput,
  type CompetitorResearchActor,
  type StartCompetitorResearchInput,
} from "@/types/schemas/competitorResearch";
import {
  competitorCapability,
  competitorLimits,
} from "./competitorResearchAccess";
import { publicCompetitorRun } from "./competitorResearchView";
import { inspectLegacySetupBeforePaidStart } from "@/server/features/projects/services/legacySetupGate";

async function current(actor: CompetitorResearchActor, projectId: string) {
  const snapshot = await repository.getSnapshot(actor, projectId);
  const capability = await competitorCapability(
    actor,
    snapshot.snapshot.domain,
  );
  return { ...snapshot, capability };
}

async function readRun(
  scope: Awaited<ReturnType<typeof repository.getSnapshot>>["scope"],
  projectId: string,
  runId: string,
) {
  const internal = await repository.getRun(scope, projectId, runId);
  if (internal.run.redactedAtMs !== null)
    return competitorResearchReadResultSchema.parse({
      state: "unavailable" as const,
      runId,
      reason: "privacy_erased" as const,
    });
  const result = competitorResearchReadResultSchema.parse({
    state: "available",
    run: publicCompetitorRun(internal),
  });
  const after = await repository.getRun(scope, projectId, runId);
  return after.run.redactedAtMs === null
    ? result
    : competitorResearchReadResultSchema.parse({
        state: "unavailable",
        runId,
        reason: "privacy_erased",
      });
}

async function reconcile(
  runId: string,
  projectId: string,
  scope: Awaited<ReturnType<typeof repository.getSnapshot>>["scope"],
) {
  const row = await repository.getRun(scope, projectId, runId);
  if (row.run.state === "finished" || row.run.redactedAtMs !== null) return;
  const status = await workflowStatus(`competitor-research-${runId}`);
  if (
    status &&
    !["queued", "running", "waiting", "waitingForPause", "paused"].includes(
      status,
    )
  ) {
    if (
      (
        await repository.finish(
          runId,
          "unknown",
          "launch_unconfirmed",
          Date.now(),
        )
      ).kind === "finished"
    )
      await markUncertainBilling(runId);
    return;
  }
  if (Date.now() < row.run.deadlineAtMs) return;
  const uncertain = row.operations.some((operation) =>
    ["issued", "unknown"].includes(operation.state),
  );
  if (
    (
      await repository.finish(
        runId,
        uncertain ? "unknown" : "blocked",
        uncertain ? "operation_outcome_unknown" : "deadline",
        Date.now(),
      )
    ).kind === "finished"
  )
    await markUncertainBilling(runId);
}

async function markUncertainBilling(runId: string) {
  const claim = await repository.claimBilling(runId, Date.now());
  if (claim.kind === "claimed")
    await repository.recordBilling(runId, claim.billingToken, "unknown");
}

async function get(actor: CompetitorResearchActor, projectId: string) {
  const { scope, snapshot, capability } = await current(actor, projectId);
  const recent = await repository.listRecent(scope, projectId);
  const projectedRuns = [];
  for (const row of recent) {
    await reconcile(row.id, projectId, scope);
    const result = await readRun(scope, projectId, row.id);
    if (result.state === "available") projectedRuns.push(result.run);
  }
  const after = await repository.getSnapshot(actor, projectId);
  if (after.snapshot.contextHash !== snapshot.contextHash)
    throw new AppError("CONFLICT", "context_changed");
  const [active] = await db
    .select({ id: runs.id })
    .from(runs)
    .where(
      and(
        eq(runs.activeProjectId, projectId),
        eq(runs.organizationId, actor.organizationId),
      ),
    )
    .limit(1);
  return competitorResearchStateSchema.parse({
    projectId,
    contextVersion: snapshot.contextVersion,
    contextHash: snapshot.contextHash,
    capabilityFingerprint: capability.capabilityFingerprint,
    ready: capability.blockedReasons.length === 0,
    blockedReasons: capability.blockedReasons,
    model: capability.model,
    limits: competitorLimits,
    activeRunId: active?.id ?? null,
    recentRuns: projectedRuns,
  });
}

async function workflowStatus(id: string) {
  try {
    return (await (await env.AI_VISIBILITY_WORKFLOW.get(id)).status()).status;
  } catch {
    return null;
  }
}

async function launch(
  runId: string,
  projectId: string,
  scope: Awaited<ReturnType<typeof repository.getSnapshot>>["scope"],
) {
  const workflowId = `competitor-research-${runId}`;
  const row = await repository.getRun(scope, projectId, runId);
  if (row.run.state === "finished" || row.run.deadlineAtMs <= Date.now())
    return;
  if (await workflowStatus(workflowId)) {
    await reconcile(runId, projectId, scope);
    return;
  }
  try {
    await startWorkflow(
      env.AI_VISIBILITY_WORKFLOW,
      { id: workflowId, params: { competitorResearchRunId: runId } },
      "competitor research",
    );
  } catch {
    // A lost create reply is uncertain. The durable ID is retained for replay.
    await reconcile(runId, projectId, scope);
  }
}

async function start(
  actor: CompetitorResearchActor,
  raw: StartCompetitorResearchInput,
) {
  const input = startCompetitorResearchInputSchema.parse(raw);
  const { scope, snapshot, businessSummary, capability } = await current(
    actor,
    input.projectId,
  );
  const [old] = await db
    .select({
      id: runs.id,
      redactedAtMs: runs.redactedAtMs,
      reason: runs.reason,
      requestHash: runs.requestHash,
      sponsorUserId: runs.sponsorUserId,
      sponsorMemberId: runs.sponsorMemberId,
      sponsorRole: runs.sponsorRole,
    })
    .from(runs)
    .where(
      and(
        eq(runs.projectId, input.projectId),
        eq(runs.organizationId, actor.organizationId),
        eq(runs.requestId, input.requestId),
      ),
    )
    .limit(1);
  const requestHash = await sha256Hex(JSON.stringify(input));
  if (old) {
    if (old.redactedAtMs !== null)
      return {
        ok: false as const,
        code: "privacy_erased" as const,
        activeRunId: null,
        currentContextVersion: null,
      };
    if (old.reason === "restored")
      return {
        ok: false as const,
        code: "conflict" as const,
        activeRunId: null,
        currentContextVersion: snapshot.contextVersion,
      };
    if (
      old.requestHash !== requestHash ||
      old.sponsorUserId !== actor.userId ||
      old.sponsorMemberId !== scope.memberId ||
      old.sponsorRole !== actor.role
    )
      return {
        ok: false as const,
        code: "conflict" as const,
        activeRunId: null,
        currentContextVersion: snapshot.contextVersion,
      };
    await launch(old.id, input.projectId, scope);
    const receipt = await readRun(scope, input.projectId, old.id);
    if (receipt.state === "unavailable")
      return {
        ok: false as const,
        code: "privacy_erased" as const,
        activeRunId: null,
        currentContextVersion: null,
      };
    return { ok: true as const, replayed: true, run: receipt.run };
  }
  if (
    input.expectedContextVersion !== snapshot.contextVersion ||
    input.contextHash !== snapshot.contextHash ||
    input.capabilityFingerprint !== capability.capabilityFingerprint
  )
    return {
      ok: false as const,
      code: "context_changed" as const,
      activeRunId: null,
      currentContextVersion: snapshot.contextVersion,
    };
  const legacy = await inspectLegacySetupBeforePaidStart(
    scope,
    input.projectId,
  );
  if (legacy.kind === "unavailable")
    throw new AppError(
      "UPSTREAM_UNAVAILABLE",
      "Legacy AI setup status needs reconciliation before new paid work.",
    );
  if (legacy.kind !== "clear")
    throw new AppError("CONFLICT", "legacy_setup_in_progress");
  const admission = await repository.admit(scope, {
    id: crypto.randomUUID(),
    input,
    requestHash,
    snapshot,
    businessSummary: truncateToBytes(businessSummary, 6000),
    blockedReason: capability.blockedReasons[0] ?? null,
    modelBackendId: capability.modelBackendId,
    modelConfigurationHash: capability.modelConfigurationHash,
    nowMs: Date.now(),
  });
  if (admission.kind === "privacy_erased")
    return {
      ok: false as const,
      code: "privacy_erased" as const,
      activeRunId: null,
      currentContextVersion: null,
    };
  if (admission.kind === "busy")
    return {
      ok: false as const,
      code: "run_in_progress" as const,
      activeRunId: admission.runId,
      currentContextVersion: snapshot.contextVersion,
    };
  if (admission.kind === "conflict" || !admission.runId)
    return {
      ok: false as const,
      code: "conflict" as const,
      activeRunId: null,
      currentContextVersion: snapshot.contextVersion,
    };
  if (capability.blockedReasons.length === 0)
    await launch(admission.runId, input.projectId, scope);
  const receipt = await readRun(scope, input.projectId, admission.runId);
  if (receipt.state === "unavailable")
    return {
      ok: false as const,
      code: "privacy_erased" as const,
      activeRunId: null,
      currentContextVersion: null,
    };
  return {
    ok: true as const,
    replayed: admission.kind === "replayed",
    run: receipt.run,
  };
}

async function getRun(
  actor: CompetitorResearchActor,
  raw: { projectId: string; runId: string },
) {
  const input = getCompetitorResearchRunInputSchema.parse(raw);
  const { scope } = await repository.getSnapshot(actor, input.projectId);
  await reconcile(input.runId, input.projectId, scope);
  const result = await readRun(scope, input.projectId, input.runId);
  await repository.getSnapshot(actor, input.projectId);
  return result;
}

async function accept(
  actor: CompetitorResearchActor,
  raw: AcceptCompetitorResearchInput,
) {
  const input = acceptCompetitorResearchInputSchema.parse(raw);
  const { scope } = await repository.getSnapshot(actor, input.projectId);
  if (!scope.requireMembership || !scope.memberId)
    throw new AppError("FORBIDDEN");
  const sorted = sort(input.selections, (a, b) =>
    a.candidateId.localeCompare(b.candidateId),
  );
  const requestHash = await sha256Hex(
    JSON.stringify({ ...input, selections: sorted }),
  );
  return repository.accept(scope, input, requestHash, Date.now());
}

export const CompetitorResearchService = { get, start, getRun, accept };
