import { createServerFn } from "@tanstack/react-start";
import { FreeBacklinksService } from "@/server/features/backlinks/services/FreeBacklinksService";
import { requireProjectContext } from "@/serverFunctions/middleware";
import { freeBacklinksInputSchema } from "@/types/schemas/freeBacklinks";

// Reads only data this installation already prepared: no provider call, no charge.
export const getFreeBacklinks = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(freeBacklinksInputSchema)
  .handler(({ data, context }) =>
    FreeBacklinksService.forProject(context.project, data.target),
  );
