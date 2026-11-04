import { createServerFn } from "@tanstack/react-start";
import { KeywordClusterService } from "@/server/features/keywords/services/KeywordClusterService";
import { KeywordGapService } from "@/server/features/keywords/services/KeywordGapService";
import { requireProjectContext } from "@/serverFunctions/middleware";
import {
  keywordClustersInputSchema,
  keywordGapRunInputSchema,
  keywordGapSetupInputSchema,
} from "@/types/schemas/keywordInsights";

export const getKeywordClusters = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(keywordClustersInputSchema)
  .handler(async ({ data, context }) =>
    KeywordClusterService.getClusters({
      projectId: context.projectId,
      projectMarket: context.project,
      requestedMarket:
        data.locationCode !== undefined && data.languageCode !== undefined
          ? { locationCode: data.locationCode, languageCode: data.languageCode }
          : undefined,
    }),
  );

export const getKeywordGapSetup = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(keywordGapSetupInputSchema)
  .handler(async ({ context }) => KeywordGapService.getSetup(context.project));

export const runKeywordGap = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(keywordGapRunInputSchema)
  .handler(async ({ data, context }) =>
    KeywordGapService.run(
      { project: context.project, competitors: data.competitors },
      context,
    ),
  );
