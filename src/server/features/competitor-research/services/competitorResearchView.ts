import {
  competitorResearchRunSchema,
  type CompetitorResearchRun,
} from "@/types/schemas/competitorResearch";
import { competitorLimits } from "./competitorResearchAccess";
import type { CompetitorResearchRepository } from "../repositories/CompetitorResearchRepository";

type InternalRun = Awaited<
  ReturnType<typeof CompetitorResearchRepository.getRun>
>;

export function publicCompetitorRun({
  run,
  candidates,
  operations,
}: InternalRun): CompetitorResearchRun {
  const costs = operations
    .map((operation) => operation.costUsd)
    .filter((cost): cost is number => cost !== null);
  const classify = operations.find(
    (operation) => operation.slot === "classify",
  );
  const visibleCandidates = candidates
    .filter(
      (candidate) =>
        candidate.classification === "verified" &&
        candidate.sourceUrl &&
        candidate.sourceExcerpt &&
        candidate.sourceHash &&
        candidate.sourceCapturedAtMs !== null &&
        candidate.extractionMethod,
    )
    .map((candidate) => ({
      id: candidate.id,
      domain: candidate.domain,
      name: candidate.name || candidate.domain,
      notes: candidate.rationale || "Source-backed suggestion",
      source: {
        url: candidate.sourceUrl!,
        excerpt: candidate.sourceExcerpt!,
        textHash: candidate.sourceHash!,
        capturedAtMs: candidate.sourceCapturedAtMs!,
      },
      extractionMethod: candidate.extractionMethod,
      partialEvidence: Boolean(candidate.partialEvidence),
    }));
  const result = {
    id: run.id,
    projectId: run.projectId,
    origin: run.origin,
    state: run.state,
    outcome: run.outcome,
    reasons: run.reason ? [run.reason] : [],
    snapshot: {
      domain: run.domain,
      locationCode: run.locationCode,
      languageCode: run.languageCode,
      contextVersion: run.contextVersion,
      contextHash: run.contextHash,
    },
    limits: run.origin === "explicit" ? competitorLimits : null,
    createdAtMs: run.createdAtMs,
    startedAtMs: run.startedAtMs,
    deadlineAtMs: run.deadlineAtMs,
    finishedAtMs: run.finishedAtMs,
    candidates: visibleCandidates,
    knownCostUsd: costs.length
      ? costs.reduce((sum, cost) => sum + cost, 0)
      : null,
    costComplete:
      run.origin === "setup"
        ? Boolean(
            run.billingToken &&
            operations.some(
              (operation) =>
                operation.slot === "setup_evidence" &&
                operation.usageBasis === "usd" &&
                operation.costUsd !== null,
            ),
          )
        : operations.every(
            (operation) =>
              operation.state === "prepared" ||
              !["search", "model"].includes(operation.kind) ||
              (["succeeded", "failed"].includes(operation.state) &&
                operation.costUsd !== null),
          ),
    modelUsage:
      classify?.state === "succeeded" && run.modelBackendId
        ? {
            backendId: run.modelBackendId,
            modelId: classify.backendModelId,
            basis: classify.usageBasis,
            costUsd: classify.costUsd,
            inputTokens: classify.inputTokens,
            outputTokens: classify.outputTokens,
          }
        : null,
    billingState: run.billingState,
    reviewState:
      run.redactedAtMs !== null
        ? "erased"
        : run.reviewedAtMs
          ? "reviewed"
          : "open",
    canAccept:
      run.redactedAtMs === null &&
      run.reason !== "restored" &&
      run.reviewedAtMs === null &&
      run.state === "finished" &&
      ["complete", "partial", "unknown"].includes(run.outcome ?? ""),
  };
  return competitorResearchRunSchema.parse(result);
}
