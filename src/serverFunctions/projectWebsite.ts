import { createServerFn } from "@tanstack/react-start";
import { ProjectWebsiteService } from "@/server/features/projects/services/ProjectWebsiteService";
import { requireProjectContext } from "@/serverFunctions/middleware";
import { webActor } from "@/serverFunctions/webActor";
import { AppError } from "@/server/lib/errors";
import {
  getProjectWebsiteResearchSchema,
  researchProjectWebsiteSchema,
  saveProjectWebsiteSetupSchema,
} from "@/types/schemas/projectWebsite";

export const researchProjectWebsite = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(researchProjectWebsiteSchema)
  .handler(({ data, context }) => {
    if (data.projectId !== context.projectId) throw new AppError("NOT_FOUND");
    return ProjectWebsiteService.startResearch(data, context, {
      actor: webActor(context),
      runSeededTracking: true,
    });
  });
export const getProjectWebsiteResearch = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(getProjectWebsiteResearchSchema)
  .handler(({ data, context }) => {
    if (data.projectId !== context.projectId) throw new AppError("NOT_FOUND");
    return ProjectWebsiteService.getResearch(
      webActor(context),
      data.projectId,
      data.attemptId,
    );
  });
export const saveProjectWebsiteSetup = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(saveProjectWebsiteSetupSchema)
  .handler(({ data, context }) =>
    ProjectWebsiteService.save(
      { ...data, projectId: context.projectId },
      context,
      "user",
      { runSeededTracking: true, actor: webActor(context) },
    ),
  );
