import { createServerFn } from "@tanstack/react-start";
import { getGscKeywordIdeas as loadGscKeywordIdeas } from "@/server/features/gsc/keywordIdeas";
import {
  GscNotConnectedError,
  isExpectedGrantFailure,
} from "@/server/features/gsc/services/GscService";
import { requireProjectContext } from "@/serverFunctions/middleware";
import { gscKeywordIdeasInputSchema } from "@/types/schemas/search-performance";

/**
 * Keyword Research with no DataForSEO key: the queries the project's site
 * already shows up for in Search Console. Free first-party data. A missing or
 * dead connection returns `connected: false` so the page can offer to connect.
 */
export const getGscKeywordIdeas = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(gscKeywordIdeasInputSchema)
  .handler(async ({ data, context }) => {
    try {
      const result = await loadGscKeywordIdeas({
        projectId: context.projectId,
        dateRange: data.dateRange,
        device: data.device,
        country: data.country,
      });
      return { connected: true as const, ...result };
    } catch (error) {
      if (
        error instanceof GscNotConnectedError ||
        isExpectedGrantFailure(error)
      ) {
        return { connected: false as const };
      }
      throw error;
    }
  });
