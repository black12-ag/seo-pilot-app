import { z } from "zod";
import {
  getGscKeywordIdeas,
  type GscKeywordIdea,
} from "@/server/features/gsc/keywordIdeas";
import { buildProjectMeta } from "@/server/mcp/context";
import { mcpResponse } from "@/server/mcp/formatters";
import { optionalMetaOutputSchema } from "@/server/mcp/output-schemas";
import { withMcpProjectAuth } from "@/server/mcp/project-auth";
import { projectIdSchema } from "@/server/mcp/schemas";
import {
  formatMcpTable,
  percentCell,
  positionCell,
  type McpTableColumn,
} from "@/server/mcp/table";
import { GscNotConnectedError, GscTokenError } from "@/server/lib/gscErrors";
import {
  GSC_DEVICES,
  SEARCH_PERFORMANCE_RANGES,
} from "@/types/schemas/search-performance";

const inputSchema = {
  projectId: projectIdSchema,
  dateRange: z
    .enum(SEARCH_PERFORMANCE_RANGES)
    .optional()
    .describe("Window to read. Defaults to last_28_days."),
  device: z.enum(GSC_DEVICES).optional(),
  country: z
    .string()
    .regex(/^[a-zA-Z]{3}$/)
    .optional()
    .describe('ISO 3166-1 alpha-3 country code, e.g. "usa".'),
  strikingDistanceOnly: z
    .boolean()
    .optional()
    .describe("Only queries at average position 5-20."),
  limit: z.number().int().min(1).max(500).optional().describe("Default 100."),
} as const;

type Args = z.infer<z.ZodObject<typeof inputSchema>>;

const COLUMNS: McpTableColumn<GscKeywordIdea>[] = [
  { header: "keyword", value: (row) => row.keyword },
  { header: "impressions", value: (row) => row.impressions },
  { header: "clicks", value: (row) => row.clicks },
  { header: "CTR", value: (row) => row.ctr, format: percentCell },
  { header: "position", value: (row) => row.position, format: positionCell },
  { header: "page", value: (row) => row.page },
];

export const getSearchConsoleKeywordIdeasTool = {
  name: "get_search_console_keyword_ideas",
  config: {
    title: "Get keyword ideas from Search Console",
    description:
      "Free keyword research for the project's own site, with no DataForSEO key: the queries its connected Search Console property already gets impressions for, with impressions, clicks, CTR, average position (one decimal) and the best-ranking page, sorted by impressions. strikingDistance marks positions 5-20. Impressions are impressions on Google for this site, not search volume, and only queries the site appeared for are listed; data is about 2-3 days behind. Save picks with save_keywords or track them with create_rank_tracker (source gsc). Read-only; uses no credits.",
    inputSchema,
    outputSchema: z
      .object({
        connected: z.boolean(),
        ideas: z.array(z.record(z.string(), z.unknown())).optional(),
        ...optionalMetaOutputSchema,
      })
      .passthrough(),
    annotations: {
      readOnlyHint: true,
      openWorldHint: true,
      destructiveHint: false,
    },
  },
  handler: withMcpProjectAuth(async (args: Args, context) => {
    const meta = buildProjectMeta(
      context,
      args.projectId,
      `/p/${args.projectId}/keywords`,
    );
    try {
      const result = await getGscKeywordIdeas({
        projectId: args.projectId,
        dateRange: args.dateRange ?? "last_28_days",
        device: args.device,
        country: args.country?.toLowerCase(),
      });
      const ideas = result.ideas
        .filter((idea) => !args.strikingDistanceOnly || idea.strikingDistance)
        .slice(0, args.limit ?? 100);
      return mcpResponse({
        text: `${ideas.length} Search Console queries for ${result.startDate} to ${result.endDate} (impressions, not search volume).\n\n${formatMcpTable(ideas, COLUMNS)}`,
        meta,
        structuredContent: {
          connected: true,
          startDate: result.startDate,
          endDate: result.endDate,
          ideas,
        },
      });
    } catch (error) {
      if (
        error instanceof GscNotConnectedError ||
        error instanceof GscTokenError
      ) {
        return mcpResponse({
          text: "Search Console isn't connected for this project (or its Google access expired). Connect it on the project's GSC Insights page, then retry.",
          meta,
          structuredContent: { connected: false },
        });
      }
      throw error;
    }
  }),
};
