import { sha256Hex } from "@/server/lib/audit/ids";
import { AppError } from "@/server/lib/errors";
import { billResearchSpend } from "@/server/billing/researchSpend";
import { CompetitorResearchRepository as competitors } from "@/server/features/competitor-research/repositories/CompetitorResearchRepository";
import { WebsiteResearchAttemptRepository as attempts } from "../repositories/WebsiteResearchAttemptRepository";
import { ProjectRepository } from "../repositories/ProjectRepository";
import {
  prepareWebsiteTracking,
  startWebsiteTrackingRun,
} from "@/server/features/ai-visibility/services/websiteTrackingSetup";
import {
  buildChatAgentModel,
  getOpenRouterAccess,
} from "@/server/lib/openrouter";
import { getOptionalEnvValue, getWorkersEnv } from "@/server/lib/runtime-env";
import {
  researchWebsiteDetailed,
  type WebsiteResearchSettlement,
} from "./websiteResearch";
import { verifiedWebsiteCandidates } from "./websiteResearchEvidence";
import { WEBSITE_UNREADABLE_MESSAGE } from "@/types/schemas/projectWebsite";

const MODEL_NOT_CONFIGURED = "model_not_configured";

async function modelDescriptor() {
  const access = getOpenRouterAccess((await getWorkersEnv()) ?? {});
  const model = access
    ? buildChatAgentModel(
        access,
        await getOptionalEnvValue("OPENROUTER_MODEL"),
        "low",
      )
    : null;
  return {
    modelBackendId: model ? "openrouter" : null,
    modelConfigurationHash: await sha256Hex(
      JSON.stringify({
        profile: "legacy_website_setup",
        accessKind: access
          ? "apiKey" in access
            ? "api_key"
            : "gateway"
          : null,
        modelId: model?.modelId ?? null,
      }),
    ),
  };
}

async function finishFailedAttempt(
  id: string,
  executionToken: string,
  runId: string | null,
  startedResearch: boolean,
  error: unknown,
) {
  // An issued model or provider call may have charged before losing its reply.
  const unreadable =
    error instanceof AppError && error.message === WEBSITE_UNREADABLE_MESSAGE;
  const uncertain = startedResearch && !unreadable;
  if (runId)
    await competitors.finish(
      runId,
      unreadable ? "failed" : uncertain ? "unknown" : "blocked",
      unreadable
        ? "website_unreadable"
        : uncertain
          ? "operation_outcome_unknown"
          : "context_changed",
      Date.now(),
    );
  await attempts.finish(
    id,
    { executionToken },
    uncertain ? "unknown" : "failed",
    unreadable
      ? "website_unreadable"
      : uncertain
        ? "operation_outcome_unknown"
        : error instanceof AppError && error.message === MODEL_NOT_CONFIGURED
          ? MODEL_NOT_CONFIGURED
          : "pre_execution_blocked",
    Date.now(),
  );
}

/** Execute a claimed receipt once. Workflow output contains only its ID. */
export async function executeWebsiteResearchAttempt(
  id: string,
  admissionToken?: string,
): Promise<{ attemptId: string }> {
  let authority = await attempts.getAuthority(id, Date.now());
  if (!authority) {
    await attempts.releaseUnstarted(id, Date.now());
    return { attemptId: id };
  }
  const { scope } = authority;
  const row = authority.row;
  if (row.state !== "admitted") return { attemptId: id };
  if (admissionToken && admissionToken !== row.admissionToken)
    return { attemptId: id };
  const claim = await attempts.claimExecution(
    scope,
    id,
    row.admissionToken,
    Date.now(),
  );
  if (claim.kind !== "claimed") return { attemptId: id };
  const executionToken = claim.executionToken;
  const customer = {
    organizationId: row.organizationId,
    projectId: row.projectId,
    userId: scope.actor.userId,
    userEmail: scope.actor.userEmail,
  };
  let runId: string | null = null;
  let runAdmissionToken: string | null = null;
  let settlement: WebsiteResearchSettlement | null = null;
  let settled = false;
  let startedResearch = false;
  const ensureAuthorized = async () => {
    if (!(await attempts.getAuthority(id, Date.now())))
      throw new AppError("FORBIDDEN", "website_research_authority_changed");
  };
  try {
    // Nothing is called without a key, so this must not read as an unknown charge.
    if (!getOpenRouterAccess((await getWorkersEnv()) ?? {}))
      throw new AppError("VALIDATION_ERROR", MODEL_NOT_CONFIGURED);
    const current = await competitors.getSnapshot(scope.actor, row.projectId);
    if (
      current.scope.memberId !== scope.memberId ||
      current.snapshot.contextHash !== row.contextHash ||
      current.snapshot.contextVersion !== row.contextVersion
    )
      throw new AppError("CONFLICT");
    if (!current.savedDomains.length) {
      const descriptor = await modelDescriptor();
      await ensureAuthorized();
      const admitted = await competitors.admitSetup(scope, {
        id: crypto.randomUUID(),
        projectId: row.projectId,
        requestId: id,
        requestHash: row.requestHash!,
        snapshot: {
          domain: row.snapshotDomain,
          locationCode: row.locationCode,
          languageCode: row.languageCode,
          contextVersion: row.contextVersion,
          contextHash: row.contextHash,
        },
        businessSummary: current.businessSummary,
        ...descriptor,
        nowMs: Date.now(),
        deadlineAtMs: row.deadlineAtMs,
      });
      if (admitted.kind !== "created")
        throw new AppError("CONFLICT", "competitor_research_in_progress");
      runId = admitted.runId;
    }
    if (runId) {
      const linked = await attempts.linkCompetitorRun(
        scope,
        id,
        executionToken,
        runId,
        Date.now(),
      );
      if (linked.kind !== "linked") throw new AppError("CONFLICT");
      const run = await competitors.getRun(scope, row.projectId, runId);
      runAdmissionToken = run.run.admissionToken;
    }
    authority = await attempts.getAuthority(id, Date.now());
    if (!authority) throw new AppError("FORBIDDEN");
    const project = await ProjectRepository.getProjectForOrganization(
      row.projectId,
      row.organizationId,
    );
    if (!project) throw new AppError("NOT_FOUND");
    startedResearch = true;
    const researched = await researchWebsiteDetailed(
      row.requestedWebsite!,
      project,
      customer,
      {
        ensureAuthorized,
        onSettled: (actual) => {
          settled = true;
          settlement = actual;
        },
      },
    );
    await ensureAuthorized();
    let review = researched.review;
    if (runId) {
      const candidates = await verifiedWebsiteCandidates(
        review,
        researched.pages,
      );
      const eligible = new Set(candidates.map((candidate) => candidate.domain));
      const lostEvidence = review.competitors.length !== candidates.length;
      if (lostEvidence)
        review = {
          ...review,
          competitors: review.competitors.filter((item) =>
            eligible.has(item.domain),
          ),
        };
      await ensureAuthorized();
      const evidence = await competitors.recordSetupEvidence(scope, {
        runId,
        snapshot: current.snapshot,
        candidates,
        outcome: lostEvidence
          ? "partial"
          : researched.searchOutcome === "not_needed"
            ? "complete"
            : researched.searchOutcome,
        nowMs: Date.now(),
      });
      if (evidence.kind !== "stored") throw new AppError("CONFLICT");
    }
    if (
      row.mode === "ai_setup" &&
      current.businessSummary &&
      current.savedDomains.length > 0
    ) {
      const tracking = await prepareWebsiteTracking(
        { projectId: row.projectId, suggestedTopics: review.suggestedTopics },
        project,
      );
      await ensureAuthorized();
      const result = await attempts.completeTopics(scope, {
        attemptId: id,
        admissionToken: row.admissionToken,
        executionToken,
        review,
        tracking,
        nowMs: Date.now(),
      });
      if (result.kind !== "applied") throw new AppError("CONFLICT");
      if (tracking && row.runSeededTracking)
        await startWebsiteTrackingRun(row.projectId, customer);
    } else {
      await ensureAuthorized();
      const completed = await attempts.complete(
        scope,
        id,
        executionToken,
        review,
        Date.now(),
      );
      if (completed.kind !== "stored") throw new AppError("CONFLICT");
    }
  } catch (error) {
    await finishFailedAttempt(
      id,
      executionToken,
      runId,
      startedResearch,
      error,
    );
  } finally {
    if (!settled) {
      const bill = await billResearchSpend(customer, []);
      settlement = {
        knownCostUsd: null,
        costComplete: false,
        billingStatus: bill.status === "not_required" ? "unknown" : bill.status,
      };
    }
    if (runId && runAdmissionToken && settlement) {
      await competitors.recordSetupSettlement({
        runId,
        admissionToken: runAdmissionToken,
        ...settlement,
        nowMs: Date.now(),
      });
    }
  }
  return { attemptId: id };
}
