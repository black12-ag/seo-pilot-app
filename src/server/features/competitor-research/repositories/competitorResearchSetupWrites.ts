import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { runBatch } from "@/db/runBatch";
import {
  projectCompetitorResearchRuns as runs,
  projectCompetitorResearchOperations as operations,
  projects,
} from "@/db/schema";
import { sha256Hex } from "@/server/lib/audit/ids";
import {
  lockAuthorityOrganization,
  lockProject,
} from "@/server/features/site-authority/repositories/siteAuthorityProjectWrites";

type Settlement = {
  runId: string;
  admissionToken: string;
  knownCostUsd: number | null;
  costComplete: boolean;
  billingStatus: "selfhost_external" | "unknown" | "not_required";
  includedInSubscription?: boolean;
  nowMs: number;
};

function validSettlement(input: Settlement) {
  return (
    (input.knownCostUsd === null ||
      (Number.isFinite(input.knownCostUsd) && input.knownCostUsd >= 0)) &&
    (!input.costComplete ||
      input.knownCostUsd !== null ||
      Boolean(input.includedInSubscription)) &&
    (input.billingStatus !== "not_required" ||
      (input.costComplete &&
        (input.knownCostUsd === 0 || Boolean(input.includedInSubscription)))) &&
    Number.isSafeInteger(input.nowMs) &&
    input.nowMs >= 0
  );
}

/** Persist an observed legacy setup bill; this receipt can never issue work. */
export async function recordSetupSettlement(input: Settlement) {
  if (!validSettlement(input)) return { kind: "conflict" } as const;
  const [run] = await db
    .select()
    .from(runs)
    .where(eq(runs.id, input.runId))
    .limit(1);
  if (!run || run.admissionToken !== input.admissionToken)
    return { kind: "blocked" } as const;
  if (
    run.origin !== "setup" ||
    run.state !== "finished" ||
    run.redactedAtMs !== null ||
    run.reason === "restored" ||
    !run.sponsorUserId
  )
    return { kind: "blocked" } as const;
  const payloadHash = await sha256Hex(
    JSON.stringify([
      input.knownCostUsd,
      input.costComplete,
      input.billingStatus,
    ]),
  );
  if (run.billingToken)
    return run.billingToken.endsWith(payloadHash)
      ? ({ kind: "replayed" } as const)
      : ({ kind: "conflict" } as const);
  const marker = `${crypto.randomUUID()}:${payloadHash}`;
  const valid = sql`exists (select 1 from projects p join "user" u on u.id=${run.sponsorUserId}
    where p.id=${run.projectId} and p.organization_id=${run.organizationId})`;
  const operationId = crypto.randomUUID();
  const usageBasis = !input.costComplete
    ? "unknown"
    : input.includedInSubscription && input.knownCostUsd === null
      ? "quota"
      : "usd";
  const receipt = sql`exists (select 1 from project_competitor_research_runs r where r.id=${run.id} and r.billing_token=${marker})`;
  try {
    await runBatch((tx) => [
      lockAuthorityOrganization(tx, run.organizationId),
      lockProject(tx, run.projectId, run.organizationId),
      tx
        .update(runs)
        .set({
          billingToken: marker,
          billingState:
            input.billingStatus === "not_required"
              ? "not_started"
              : input.billingStatus,
        })
        .where(
          and(
            eq(runs.id, run.id),
            eq(runs.projectId, run.projectId),
            eq(runs.organizationId, run.organizationId),
            eq(runs.admissionToken, input.admissionToken),
            eq(runs.origin, "setup"),
            eq(runs.state, "finished"),
            isNull(runs.redactedAtMs),
            isNull(runs.billingToken),
            sql`coalesce(${runs.reason},'') <> 'restored'`,
            valid,
          ),
        ),
      tx
        .insert(operations)
        .select(
          sql`select ${operationId},${run.projectId},${run.id},'setup_evidence','legacy','unknown',null,null,null,null,null,null,${input.nowMs},null,null,null,null,${usageBasis},${input.knownCostUsd},null,null where ${receipt}`,
        )
        .onConflictDoNothing(),
      tx
        .update(operations)
        .set({
          costUsd: input.knownCostUsd,
          usageBasis,
        })
        .where(
          and(
            eq(operations.runId, run.id),
            eq(operations.slot, "setup_evidence"),
            receipt,
          ),
        ),
      // A failed conditional claim must roll back every accounting write.
      tx
        .update(projects)
        .set({ name: sql`null` })
        .where(and(eq(projects.id, run.projectId), sql`not (${receipt})`)),
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
        .select({
          token: runs.billingToken,
          state: runs.state,
          redactedAtMs: runs.redactedAtMs,
          reason: runs.reason,
          admissionToken: runs.admissionToken,
          livePair: valid,
        })
        .from(runs)
        .where(eq(runs.id, run.id))
        .limit(1);
      if (after?.token?.endsWith(payloadHash))
        return { kind: "replayed" } as const;
      if (after?.token) return { kind: "conflict" } as const;
      if (
        !after ||
        after.state !== "finished" ||
        after.redactedAtMs !== null ||
        after.reason === "restored" ||
        after.admissionToken !== input.admissionToken ||
        !after.livePair
      )
        return { kind: "blocked" } as const;
    }
    throw error;
  }
  const [current] = await db
    .select({ billingToken: runs.billingToken })
    .from(runs)
    .where(eq(runs.id, run.id))
    .limit(1);
  if (current?.billingToken === marker) return { kind: "stored" } as const;
  return current?.billingToken?.endsWith(payloadHash)
    ? ({ kind: "replayed" } as const)
    : ({ kind: "blocked" } as const);
}
