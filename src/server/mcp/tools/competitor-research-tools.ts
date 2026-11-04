import { z } from "zod";
import { CompetitorResearchService } from "@/server/features/competitor-research/services/CompetitorResearchService";
import { buildProjectMeta, type ToolAuthContext } from "@/server/mcp/context";
import { mcpResponse } from "@/server/mcp/formatters";
import { optionalMetaOutputSchema } from "@/server/mcp/output-schemas";
import { withMcpProjectAuth } from "@/server/mcp/project-auth";
import {
  acceptCompetitorResearchInputSchema,
  acceptCompetitorResearchResultSchema,
  competitorResearchCandidateSchema,
  competitorResearchLimitsSchema,
  competitorResearchReadResultSchema,
  competitorResearchRunSchema,
  competitorResearchSnapshotSchema,
  competitorResearchStateSchema,
  getCompetitorResearchInputSchema,
  getCompetitorResearchRunInputSchema,
  startCompetitorResearchInputSchema,
  startCompetitorResearchResultSchema,
} from "@/types/schemas/competitorResearch";

// The shared DTOs stay strict so the service cannot leak extra fields. Published
// MCP output must accept added fields at every depth, since clients cache it.
const limitsOutput = competitorResearchLimitsSchema.loose();
const runOutput = competitorResearchRunSchema
  .extend({
    snapshot: competitorResearchSnapshotSchema.loose(),
    limits: limitsOutput.nullable(),
    candidates: z
      .array(
        competitorResearchCandidateSchema
          .extend({
            source: competitorResearchCandidateSchema.shape.source.loose(),
          })
          .loose(),
      )
      .max(5),
    modelUsage: competitorResearchRunSchema.shape.modelUsage
      .unwrap()
      .loose()
      .nullable(),
  })
  .loose();
const stateOutput = competitorResearchStateSchema
  .extend({
    ...optionalMetaOutputSchema,
    model: competitorResearchStateSchema.shape.model.loose(),
    limits: limitsOutput,
    recentRuns: z.array(runOutput).max(10),
  })
  .loose();
const readOutput = z.discriminatedUnion("state", [
  competitorResearchReadResultSchema.options[0]
    .extend({ ...optionalMetaOutputSchema, run: runOutput })
    .loose(),
  competitorResearchReadResultSchema.options[1]
    .extend(optionalMetaOutputSchema)
    .loose(),
]);
const startOutput = z.discriminatedUnion("ok", [
  startCompetitorResearchResultSchema.options[0]
    .extend({ ...optionalMetaOutputSchema, run: runOutput })
    .loose(),
  startCompetitorResearchResultSchema.options[1]
    .extend(optionalMetaOutputSchema)
    .loose(),
]);
const acceptOutput = z.discriminatedUnion("ok", [
  acceptCompetitorResearchResultSchema.options[0]
    .extend({
      ...optionalMetaOutputSchema,
      rows: z
        .array(
          acceptCompetitorResearchResultSchema.options[0].shape.rows.element.loose(),
        )
        .max(5),
    })
    .loose(),
  acceptCompetitorResearchResultSchema.options[1]
    .extend(optionalMetaOutputSchema)
    .loose(),
]);
const contextPath = (projectId: string) => `/p/${projectId}/context`;
const actor = (
  auth: Pick<
    ToolAuthContext,
    "userId" | "userEmail" | "organizationId" | "role"
  >,
  surface: "mcp" | "sam",
) => ({
  userId: auth.userId,
  userEmail: auth.userEmail,
  organizationId: auth.organizationId,
  role: auth.role,
  surface,
});

export function getCompetitorResearchTool(surface: "mcp" | "sam") {
  return {
    name: "get_competitor_research",
    config: {
      title: "Get competitor research",
      description:
        "Read current competitor-discovery readiness, fixed workload limits and recent project runs. No search, crawl or model work is started by this read.",
      inputSchema: getCompetitorResearchInputSchema,
      outputSchema: stateOutput,
      annotations: {
        readOnlyHint: true,
        openWorldHint: false,
        destructiveHint: false,
        idempotentHint: true,
      },
    },
    handler: withMcpProjectAuth(
      async (
        args: z.infer<typeof getCompetitorResearchInputSchema>,
        context,
      ) => {
        const state = await CompetitorResearchService.get(
          actor(context.auth, surface),
          args.projectId,
        );
        return mcpResponse({
          text: state.ready
            ? `Competitor discovery is available. One explicit run can use up to ${state.limits.maxQueries} searches at depth ${state.limits.searchDepth}, ${state.limits.maxPages} public pages and ${state.limits.maxModelCalls} model call. Actual provider spend or quota use is not capped in dollars; no competitors are saved automatically.`
            : `Competitor discovery unavailable: ${state.blockedReasons.join(", ")}. No work was started.`,
          structuredContent: state,
          meta: buildProjectMeta(
            context,
            args.projectId,
            contextPath(args.projectId),
          ),
        });
      },
    ),
  };
}

export function startCompetitorResearchTool(surface: "mcp" | "sam") {
  return {
    name: "start_competitor_research",
    config: {
      title: "Start competitor research",
      description:
        "Explicitly start one bounded paid/quota competitor-discovery run after the user confirms the work. Requires a stable requestId, current context/capability hashes and confirmedPaidWork=true. Up to two depth-10 searches, six public pages and one model call may incur real provider cost; this does not save competitors or start tracking. Retry the same requestId only to resume its receipt.",
      inputSchema: startCompetitorResearchInputSchema,
      outputSchema: startOutput,
      annotations: {
        readOnlyHint: false,
        openWorldHint: true,
        destructiveHint: false,
        idempotentHint: true,
      },
    },
    handler: withMcpProjectAuth(
      async (
        args: z.infer<typeof startCompetitorResearchInputSchema>,
        context,
      ) => {
        const result = await CompetitorResearchService.start(
          actor(context.auth, surface),
          args,
        );
        return mcpResponse({
          text: result.ok
            ? `Competitor run ${result.run.id}: ${result.run.state}${result.replayed ? " (existing receipt)" : ""}. Review candidates before adding any domain; no tracking was started.`
            : `Competitor run not started: ${result.code}. Refresh project readiness or resume the original request as appropriate.`,
          structuredContent: result,
          meta: buildProjectMeta(
            context,
            args.projectId,
            contextPath(args.projectId),
          ),
        });
      },
    ),
  };
}

export function getCompetitorResearchRunTool(surface: "mcp" | "sam") {
  return {
    name: "get_competitor_research_run",
    config: {
      title: "Get competitor research run",
      description:
        "Read one existing run, candidate source URLs, capture dates, rationales, partial/unknown outcome and known actual cost. An erased run returns an unavailable wrapper. This read does not launch or retry paid work.",
      inputSchema: getCompetitorResearchRunInputSchema,
      outputSchema: readOutput,
      annotations: {
        readOnlyHint: true,
        openWorldHint: false,
        destructiveHint: false,
        idempotentHint: true,
      },
    },
    handler: withMcpProjectAuth(
      async (
        args: z.infer<typeof getCompetitorResearchRunInputSchema>,
        context,
      ) => {
        const result = await CompetitorResearchService.getRun(
          actor(context.auth, surface),
          args,
        );
        return mcpResponse({
          text:
            result.state === "available"
              ? `Competitor run ${result.run.id}: ${result.run.outcome ?? result.run.state}; ${result.run.candidates.length} sourced suggestion(s). Known cost: ${result.run.knownCostUsd === null ? "unreported" : `$${result.run.knownCostUsd.toFixed(4)}`}${result.run.costComplete ? "" : " (incomplete)"}. Review before saving.`
              : `Competitor run ${result.runId} is unavailable after privacy erasure.`,
          structuredContent: result,
          meta: buildProjectMeta(
            context,
            args.projectId,
            contextPath(args.projectId),
          ),
        });
      },
    ),
  };
}

export function acceptCompetitorResearchTool(surface: "mcp" | "sam") {
  return {
    name: "accept_competitor_research",
    config: {
      title: "Accept competitor suggestions",
      description:
        "After user review, add only selected sourced candidate IDs to the project competitor list with editable name/notes. Domain edits use the manual competitor form and carry no source verification. An empty selection records a no-op review; this does not approve content, publish, or start tracking. Use a stable mutationId for replay.",
      inputSchema: acceptCompetitorResearchInputSchema,
      outputSchema: acceptOutput,
      annotations: {
        readOnlyHint: false,
        openWorldHint: false,
        destructiveHint: false,
        idempotentHint: true,
      },
    },
    handler: withMcpProjectAuth(
      async (
        args: z.infer<typeof acceptCompetitorResearchInputSchema>,
        context,
      ) => {
        const result = await CompetitorResearchService.accept(
          actor(context.auth, surface),
          args,
        );
        return mcpResponse({
          text: result.ok
            ? `Reviewed run ${result.runId}: ${result.rows.filter((row) => row.outcome === "added").length} new competitor(s) added${result.replayed ? " (historical receipt replay)" : ""}. No content was approved or published.`
            : `Competitor review not applied: ${result.code}. Refresh the project and review the same draft before submitting again.`,
          structuredContent: result,
          meta: buildProjectMeta(
            context,
            args.projectId,
            contextPath(args.projectId),
          ),
        });
      },
    ),
  };
}
