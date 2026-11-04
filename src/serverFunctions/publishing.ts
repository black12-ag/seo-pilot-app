import { createServerFn } from "@tanstack/react-start";
import { WordPressConnectionService } from "@/server/features/publishing/services/WordPressConnectionService";
import { WordPressPublishingService } from "@/server/features/publishing/services/WordPressPublishingService";
import { AppError } from "@/server/lib/errors";
import { requireProjectContext } from "@/serverFunctions/middleware";
import {
  connectWordPressInputSchema,
  publishDraftInputSchema,
  publishingProjectInputSchema,
  publishPreviewInputSchema,
  publishRecordInputSchema,
  wordPressGrantInputSchema,
} from "@/types/schemas/publishing";

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

export const getPublishingStatus = createServerFn({ method: "GET" })
  .middleware(requireProjectContext)
  .validator(publishingProjectInputSchema)
  .handler(async ({ context, data }) =>
    WordPressConnectionService.status(actorFor(context, data.projectId), data),
  );
export const connectWordPress = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(connectWordPressInputSchema)
  .handler(async ({ context, data }) =>
    WordPressConnectionService.connect(actorFor(context, data.projectId), data),
  );
export const checkWordPressGrant = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(wordPressGrantInputSchema)
  .handler(async ({ context, data }) =>
    WordPressConnectionService.checkGrant(
      actorFor(context, data.projectId),
      data,
    ),
  );
export const revokeWordPressGrant = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(wordPressGrantInputSchema)
  .handler(async ({ context, data }) =>
    WordPressConnectionService.revokeGrant(
      actorFor(context, data.projectId),
      data,
    ),
  );
export const disconnectWordPress = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(publishingProjectInputSchema)
  .handler(async ({ context, data }) =>
    WordPressConnectionService.disconnect(
      actorFor(context, data.projectId),
      data,
    ),
  );
export const previewWordPressDraft = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(publishPreviewInputSchema)
  .handler(async ({ context, data }) =>
    WordPressPublishingService.preview(actorFor(context, data.projectId), data),
  );
export const publishWordPressDraft = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(publishDraftInputSchema)
  .handler(async ({ context, data }) =>
    WordPressPublishingService.publish(actorFor(context, data.projectId), data),
  );
export const reconcileWordPressRecord = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(publishRecordInputSchema)
  .handler(async ({ context, data }) =>
    WordPressPublishingService.reconcile(
      actorFor(context, data.projectId),
      data,
    ),
  );
export const trashWordPressRecord = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(publishRecordInputSchema)
  .handler(async ({ context, data }) =>
    WordPressPublishingService.trash(actorFor(context, data.projectId), data),
  );
