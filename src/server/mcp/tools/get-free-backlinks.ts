import { z } from "zod";
import { FreeBacklinksService } from "@/server/features/backlinks/services/FreeBacklinksService";
import { buildProjectMeta } from "@/server/mcp/context";
import { mcpResponse } from "@/server/mcp/formatters";
import { optionalMetaOutputSchema } from "@/server/mcp/output-schemas";
import { withMcpProjectAuth } from "@/server/mcp/project-auth";
import { projectIdSchema } from "@/server/mcp/schemas";

const DEFAULT_LIMIT = 50;

const inputSchema = {
  projectId: projectIdSchema,
  target: z
    .string()
    .max(2048)
    .optional()
    .describe(
      "The project's site or one of its saved competitors. Omit for the project's own site.",
    ),
  limit: z
    .number()
    .int()
    .min(1)
    .max(500)
    .optional()
    .describe(
      `Referring domains to list, most crawled hosts first. Default ${DEFAULT_LIMIT}.`,
    ),
} as const;

type Args = z.infer<z.ZodObject<typeof inputSchema>>;

const STATUS_TEXT = {
  not_tracked:
    "is not this project's site or a saved competitor. Add it as a competitor on the Context page; it is prepared on the next monthly run.",
  not_prepared:
    "has no Common Crawl data prepared yet. An administrator runs the monthly free-backlinks command (docs/FREE_BACKLINKS.md).",
} as const;

export const getFreeBacklinksTool = {
  name: "get_free_backlinks",
  config: {
    title: "Get free backlinks (Common Crawl)",
    description:
      "Free, no DataForSEO key: which sites (registrable domains) link to the project's site or one of its saved competitors, from Common Crawl's public web graph that this installation prepared. Lists the referring-domain count for every tracked domain and, for the target, its referring domains with crawled-host counts. Domain-level and sampled: no single links, anchors or nofollow, counts are lower than paid tools, and each release covers about three months, a few months old. Compare releases only when both are named. Read-only; uses no credits.",
    inputSchema,
    outputSchema: z.looseObject({
      tracked: z.array(z.looseObject({})),
      selected: z.looseObject({}).nullable(),
      ...optionalMetaOutputSchema,
    }),
    annotations: {
      readOnlyHint: true,
      openWorldHint: false,
      destructiveHint: false,
    },
  },
  handler: withMcpProjectAuth(async (args: Args, context) => {
    const result = await FreeBacklinksService.forProject(
      context.project,
      args.target,
    );
    const limit = args.limit ?? DEFAULT_LIMIT;
    const lines = result.tracked.map(
      (row) =>
        `- ${row.domain} (${row.role}): ${row.referringDomains ?? "not prepared"} referring domains`,
    );
    const selected = result.selected;
    if (!selected) {
      lines.push("", "This project has no website set.");
    } else if (selected.status !== "ready") {
      lines.push("", `${selected.domain} ${STATUS_TEXT[selected.status]}`);
    } else {
      const shown = selected.referrers.slice(0, limit);
      lines.push(
        "",
        `${selected.domain}: ${selected.referringDomains} referring domains in Common Crawl release ${selected.release} (published ${selected.publishedAt ?? "unknown"}, prepared ${selected.importedAt}). Top ${shown.length} by crawled hosts:`,
        ...shown.map((row) => `- ${row.domain} (${row.hosts} hosts)`),
      );
    }
    return mcpResponse({
      text: lines.join("\n"),
      meta: buildProjectMeta(
        context,
        args.projectId,
        `/p/${args.projectId}/backlinks`,
      ),
      structuredContent: {
        tracked: result.tracked,
        selected:
          selected?.status === "ready"
            ? { ...selected, referrers: selected.referrers.slice(0, limit) }
            : selected,
      },
    });
  }),
};
