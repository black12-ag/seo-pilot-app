import { createServerFn } from "@tanstack/react-start";
import { CompetitorResearchService } from "@/server/features/competitor-research/services/CompetitorResearchService";
import { AppError } from "@/server/lib/errors";
import { requireProjectContext } from "@/serverFunctions/middleware";
import {
  acceptCompetitorResearchInputSchema,
  acceptCompetitorResearchResultSchema,
  competitorResearchReadResultSchema,
  competitorResearchStateSchema,
  getCompetitorResearchInputSchema,
  getCompetitorResearchRunInputSchema,
  startCompetitorResearchInputSchema,
  startCompetitorResearchResultSchema,
} from "@/types/schemas/competitorResearch";

function boundProject(requested: string, bound: string) {
  if (requested !== bound) throw new AppError("NOT_FOUND");
  return bound;
}

export const getCompetitorResearch = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(getCompetitorResearchInputSchema)
  .handler(async ({ data, context }) =>
    competitorResearchStateSchema.parse(
      await CompetitorResearchService.get(
        {
          userId: context.userId,
          userEmail: context.userEmail,
          organizationId: context.organizationId,
          role: context.role,
          surface: "web",
        },
        boundProject(data.projectId, context.projectId),
      ),
    ),
  );

export const startCompetitorResearch = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(startCompetitorResearchInputSchema)
  .handler(async ({ data, context }) =>
    startCompetitorResearchResultSchema.parse(
      await CompetitorResearchService.start(
        {
          userId: context.userId,
          userEmail: context.userEmail,
          organizationId: context.organizationId,
          role: context.role,
          surface: "web",
        },
        { ...data, projectId: boundProject(data.projectId, context.projectId) },
      ),
    ),
  );

export const getCompetitorResearchRun = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(getCompetitorResearchRunInputSchema)
  .handler(async ({ data, context }) =>
    competitorResearchReadResultSchema.parse(
      await CompetitorResearchService.getRun(
        {
          userId: context.userId,
          userEmail: context.userEmail,
          organizationId: context.organizationId,
          role: context.role,
          surface: "web",
        },
        { ...data, projectId: boundProject(data.projectId, context.projectId) },
      ),
    ),
  );

export const acceptCompetitorResearch = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(acceptCompetitorResearchInputSchema)
  .handler(async ({ data, context }) =>
    acceptCompetitorResearchResultSchema.parse(
      await CompetitorResearchService.accept(
        {
          userId: context.userId,
          userEmail: context.userEmail,
          organizationId: context.organizationId,
          role: context.role,
          surface: "web",
        },
        { ...data, projectId: boundProject(data.projectId, context.projectId) },
      ),
    ),
  );
