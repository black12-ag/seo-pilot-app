import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { getRequest } from "@tanstack/react-start/server";
import { getPublicOrigin } from "@/server/mcp/public-origin";
import { AiVisibilityService } from "@/server/features/ai-visibility/services/AiVisibilityService";
import { requireProjectContext } from "@/serverFunctions/middleware";
import { webActor } from "@/serverFunctions/webActor";
import { generateAiPromptsSchema } from "@/types/schemas/aiPromptSuggestions";
import { researchAiPromptsSchema } from "@/types/schemas/aiPromptResearch";
import {
  aiProjectSchema,
  saveAiTrackerSchema,
  estimateAiCostSchema,
  setAiScheduleSchema,
  runAiCheckSchema,
  getAiRunSchema,
  aiPageResultsSchema,
  aiSourcesSchema,
  aiSourceDetailSchema,
  aiSourceReportSchema,
  aiAnswerSchema,
  aiExportSchema,
  aiTrendSchema,
} from "@/types/schemas/ai-visibility";

export const generateAiVisibilityPrompts = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(generateAiPromptsSchema)
  .handler(({ data, context }) =>
    AiVisibilityService.generatePrompts(
      { ...data, projectId: context.projectId },
      context,
    ),
  );

export const researchAiVisibilityPrompts = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(researchAiPromptsSchema)
  .handler(({ data, context }) =>
    AiVisibilityService.researchPrompts(
      { ...data, projectId: context.projectId },
      context,
    ),
  );

const startAiResearchSetupSchema = aiProjectSchema.extend({
  requestId: z.string().uuid().optional(),
  confirmedPaidWork: z.literal(true).optional(),
});
export const getAiResearchSetup = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(aiProjectSchema)
  .handler(({ context }) =>
    AiVisibilityService.getSetup(
      { projectId: context.projectId },
      webActor(context),
    ),
  );

export const startAiResearchSetup = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(startAiResearchSetupSchema)
  .handler(({ data, context }) =>
    AiVisibilityService.startSetup(
      { ...data, projectId: context.projectId },
      context,
      { actor: webActor(context), runSeededTracking: true },
    ),
  );

export const listAiResearchKeywords = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(aiProjectSchema)
  .handler(({ context }) =>
    AiVisibilityService.listResearchKeywords({ projectId: context.projectId }),
  );

export const getAiVisibilityTracker = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(aiProjectSchema)
  .handler(({ context }) =>
    AiVisibilityService.getTracker({ projectId: context.projectId }),
  );

export const saveAiVisibilityTracker = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(saveAiTrackerSchema)
  .handler(({ data, context }) =>
    AiVisibilityService.saveTracker({ ...data, projectId: context.projectId }),
  );

export const estimateAiVisibilityCost = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(estimateAiCostSchema)
  .handler(({ data, context }) =>
    AiVisibilityService.estimateCost({ ...data, projectId: context.projectId }),
  );

export const setAiVisibilitySchedule = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(setAiScheduleSchema)
  .handler(({ data, context }) =>
    AiVisibilityService.setSchedule(
      { ...data, projectId: context.projectId },
      context,
    ),
  );

export const runAiVisibilityCheck = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(runAiCheckSchema)
  .handler(({ data, context }) =>
    AiVisibilityService.runCheck(
      { ...data, projectId: context.projectId },
      context,
    ),
  );

export const getAiVisibilityRun = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(getAiRunSchema)
  .handler(({ data, context }) =>
    AiVisibilityService.getRun({ ...data, projectId: context.projectId }),
  );

export const getAiVisibilityResults = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(aiPageResultsSchema)
  .handler(({ data, context }) =>
    AiVisibilityService.getPageResults({
      ...data,
      projectId: context.projectId,
    }),
  );

export const getAiVisibilitySources = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(aiSourcesSchema)
  .handler(({ data, context }) =>
    AiVisibilityService.getSources({ ...data, projectId: context.projectId }),
  );

export const getAiVisibilitySourceReport = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(aiSourceReportSchema)
  .handler(({ data, context }) =>
    AiVisibilityService.getSourceReport({
      ...data,
      projectId: context.projectId,
    }),
  );

export const getAiVisibilitySourceDetail = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(aiSourceDetailSchema)
  .handler(({ data, context }) =>
    AiVisibilityService.getSourceDetail({
      ...data,
      projectId: context.projectId,
    }),
  );

export const getAiVisibilityTrend = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(aiTrendSchema)
  .handler(({ data, context }) =>
    AiVisibilityService.getTrend({ ...data, projectId: context.projectId }),
  );

export const getAiVisibilityAnswer = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(aiAnswerSchema)
  .handler(({ data, context }) =>
    AiVisibilityService.getAnswer({ ...data, projectId: context.projectId }),
  );

export const exportAiVisibilityData = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(aiExportSchema)
  .handler(({ data, context }) =>
    AiVisibilityService.exportData(
      { ...data, projectId: context.projectId },
      getPublicOrigin(getRequest()),
    ),
  );
