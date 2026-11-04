import { createServerFn } from "@tanstack/react-start";
import { OpportunitiesService } from "@/server/features/opportunities/services/OpportunitiesService";
import { requireProjectContext } from "@/serverFunctions/middleware";
import { dashboardProjectInputSchema } from "@/types/schemas/dashboard";

export const getOpportunities = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(dashboardProjectInputSchema)
  .handler(({ context }) =>
    OpportunitiesService.list({
      projectId: context.projectId,
      organizationId: context.organizationId,
    }),
  );
