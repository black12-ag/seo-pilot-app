import { CompetitorResearchRepository as repository } from "../repositories/CompetitorResearchRepository";
import {
  billResearchSpend,
  type ResearchSpend,
} from "@/server/billing/researchSpend";
import { runCompetitorOperations } from "./competitorResearchOperations";

async function settle(runId: string) {
  const claim = await repository.claimBilling(runId, Date.now());
  if (claim.kind !== "claimed") return;
  const billingContext = await repository.getBillingContext(
    runId,
    claim.billingToken,
  );
  if (!billingContext) {
    await repository.recordBilling(runId, claim.billingToken, "unknown");
    return;
  }
  const spend: ResearchSpend[] = claim.spend.flatMap(
    (operation): ResearchSpend[] => {
      if (operation.costUsd === null || operation.costUsd <= 0) return [];
      if (operation.provider === "dataforseo")
        return [
          {
            provider: "dataforseo",
            creditFeature: "keyword_research",
            operation: "competitor_research_serp",
            costUsd: operation.costUsd,
          },
        ];
      if (operation.kind === "model")
        return [
          {
            provider: "openrouter",
            creditFeature: "agent",
            operation: "competitor_research_classify",
            costUsd: operation.costUsd,
          },
        ];
      return [];
    },
  );
  try {
    const result = await billResearchSpend(billingContext, spend);
    await repository.recordBilling(
      runId,
      claim.billingToken,
      result.status === "selfhost_external" ? "selfhost_external" : "unknown",
    );
  } catch {
    await repository.recordBilling(runId, claim.billingToken, "unknown");
  }
}

export async function runCompetitorResearch(
  runId: string,
): Promise<{ runId: string }> {
  let result: Awaited<ReturnType<typeof runCompetitorOperations>>;
  try {
    result = await runCompetitorOperations(runId);
  } catch {
    // An unexpected failure after issuance cannot prove the provider did not charge.
    result = { outcome: "unknown", reason: "operation_outcome_unknown" };
  }
  if (result) {
    const current = await repository.getAuthority(runId);
    if (
      current &&
      Date.now() >= current.run.deadlineAtMs &&
      ["complete", "partial"].includes(result.outcome)
    )
      result = { outcome: "unknown", reason: "deadline" };
    await repository.finish(runId, result.outcome, result.reason, Date.now());
    await settle(runId);
  }
  return { runId };
}
