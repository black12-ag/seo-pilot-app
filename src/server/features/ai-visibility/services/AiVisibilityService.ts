import { getTracker } from "./aiVisibilityState";
import { saveTracker } from "./aiVisibilitySetup";
import { estimateCost } from "./aiVisibilityCost";
import { setSchedule } from "./aiVisibilitySchedule";
import { runCheck, getRun } from "./aiVisibilityRuns";
import {
  loadAiResults,
  loadAiSources,
  loadAiAnswer,
  loadAiPageResults,
} from "./aiVisibilityResults";
import { exportAiData } from "./aiVisibilityExport";
import { loadAiTrend } from "./aiVisibilityTrend";
import { loadAiSourceDetail, loadAiSourceReport } from "./aiVisibilitySources";
import { listAiResearchKeywords, researchAiPrompts } from "./aiPromptResearch";
import type { GenerateAiPromptsInput } from "@/types/schemas/aiPromptSuggestions";
import type { BillingCustomerContext } from "@/server/billing/subscription";
import type { CompetitorResearchActor } from "@/types/schemas/competitorResearch";
import { AppError } from "@/server/lib/errors";
import { usesBetterAuthServer } from "@/server/lib/runtime-env";
export const AiVisibilityService = {
  generatePrompts: async (
    input: GenerateAiPromptsInput,
    billing: BillingCustomerContext,
  ) =>
    (await import("./aiPromptSuggestions")).generateAiPrompts(input, billing),
  getResearchSetup: async (input: { projectId: string }) =>
    (await import("./aiResearchKeywords")).getAiResearchSetup(input.projectId),
  startResearchSetup: async (
    input: { projectId: string },
    billing: BillingCustomerContext,
    options?: { runSeededTracking?: boolean },
  ) =>
    (await import("./aiResearchKeywords")).startAiResearchSetup(
      input,
      billing,
      options,
    ),
  getResearchAttemptSetup: async (
    input: { projectId: string },
    actor: CompetitorResearchActor,
  ) =>
    (await import("./aiResearchKeywords")).getAiResearchAttemptSetup(
      input.projectId,
      actor,
    ),
  startResearchAttemptSetup: async (
    input: { projectId: string; requestId: string; confirmedPaidWork: true },
    billing: BillingCustomerContext,
    options: {
      actor: CompetitorResearchActor;
      runSeededTracking?: boolean;
    },
  ) =>
    (await import("./aiResearchKeywords")).startAiResearchAttemptSetup(
      input,
      billing,
      options,
    ),
  /** Better Auth setup reads trusted attempts; delegated modes read Workflows. */
  getSetup: async (
    input: { projectId: string },
    actor: CompetitorResearchActor,
  ) =>
    (await usesBetterAuthServer())
      ? AiVisibilityService.getResearchAttemptSetup(input, actor)
      : AiVisibilityService.getResearchSetup(input),
  startSetup: async (
    input: {
      projectId: string;
      requestId?: string;
      confirmedPaidWork?: true;
    },
    billing: BillingCustomerContext,
    options: {
      actor: CompetitorResearchActor;
      runSeededTracking?: boolean;
    },
  ) => {
    if (!(await usesBetterAuthServer()))
      return AiVisibilityService.startResearchSetup(
        { projectId: input.projectId },
        billing,
        { runSeededTracking: options.runSeededTracking },
      );
    const { projectId, requestId, confirmedPaidWork } = input;
    if (!requestId || !confirmedPaidWork)
      throw new AppError(
        "VALIDATION_ERROR",
        "A confirmed AI research request ID is required.",
      );
    return AiVisibilityService.startResearchAttemptSetup(
      { projectId, requestId, confirmedPaidWork },
      billing,
      options,
    );
  },
  researchPrompts: researchAiPrompts,
  listResearchKeywords: listAiResearchKeywords,
  getTracker,
  saveTracker,
  estimateCost,
  setSchedule,
  runCheck,
  getRun,
  getResults: loadAiResults,
  getPageResults: loadAiPageResults,
  getSources: loadAiSources,
  getSourceReport: loadAiSourceReport,
  getSourceDetail: loadAiSourceDetail,
  getTrend: loadAiTrend,
  getAnswer: loadAiAnswer,
  exportData: exportAiData,
};
