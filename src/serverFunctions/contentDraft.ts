import { createServerFn } from "@tanstack/react-start";
import { ContentDraftService } from "@/server/features/content/services/ContentDraftService";
import { AppError } from "@/server/lib/errors";
import { requireProjectContext } from "@/serverFunctions/middleware";
import {
  contentDraftRequestSchema,
  contentDraftSetupInputSchema,
  generateContentDraftInputSchema,
} from "@/types/schemas/contentDraft";

function actorFor(
  context: {
    userId: string;
    organizationId: string;
    role: string;
    projectId: string;
  },
  projectId: string,
) {
  if (projectId !== context.projectId) throw new AppError("NOT_FOUND");
  return {
    userId: context.userId,
    organizationId: context.organizationId,
    role: context.role,
    surface: "web" as const,
  };
}

export const getContentDraftSetup = createServerFn({ method: "GET" })
  .middleware(requireProjectContext)
  .validator(contentDraftSetupInputSchema)
  .handler(async ({ context, data }) =>
    ContentDraftService.getSetup(actorFor(context, data.projectId), data),
  );

export const generateContentDraft = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(generateContentDraftInputSchema)
  .handler(async ({ context, data }) =>
    ContentDraftService.generate(
      actorFor(context, data.projectId),
      data,
      context.userEmail,
    ),
  );

export const getContentDraftRequest = createServerFn({ method: "GET" })
  .middleware(requireProjectContext)
  .validator(contentDraftRequestSchema)
  .handler(async ({ context, data }) =>
    ContentDraftService.getRequest(actorFor(context, data.projectId), data),
  );
