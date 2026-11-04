import { sort } from "remeda";
import type {
  OpportunitiesResult,
  Opportunity,
  OpportunitySeverity,
  OpportunitySourceId,
} from "@/shared/opportunities";
import { readAiVisibility } from "./aiVisibilityOpportunities";
import {
  SOURCE_META,
  type SourceInput,
  type SourceReading,
} from "./opportunityParts";
import {
  readCompetitors,
  readSearchConsole,
  readSiteAudit,
} from "./opportunitySources";

const SEVERITY_ORDER: Record<OpportunitySeverity, number> = {
  high: 0,
  medium: 1,
  low: 2,
};

// The rule shown on the page as OPPORTUNITY_RANKING_RULE. Keep them in step.
function byRank(a: Opportunity, b: Opportunity) {
  const severity = (item: Opportunity) =>
    item.severity ? SEVERITY_ORDER[item.severity] : Number.MAX_SAFE_INTEGER;
  return (
    severity(a) - severity(b) ||
    (b.affected?.count ?? 0) - (a.affected?.count ?? 0) ||
    a.title.localeCompare(b.title)
  );
}

const SOURCES: {
  id: OpportunitySourceId;
  read: (input: SourceInput) => Promise<SourceReading>;
}[] = [
  { id: "site_audit", read: readSiteAudit },
  { id: "search_console", read: readSearchConsole },
  { id: "ai_visibility", read: readAiVisibility },
  { id: "competitors", read: readCompetitors },
];

/**
 * One ranked list of what to do next, computed from saved evidence on each
 * read. It stores nothing and makes no provider calls. A source that can't be
 * read reports that, so the rest of the list still loads and nothing reads as
 * "no problems".
 */
async function list(input: SourceInput): Promise<OpportunitiesResult> {
  const readings = await Promise.all(
    SOURCES.map(async ({ id, read }): Promise<SourceReading> => {
      try {
        return await read(input);
      } catch (error) {
        console.error("[opportunities] source read failed", {
          source: id,
          projectId: input.projectId,
          error,
        });
        return {
          source: {
            ...SOURCE_META[id],
            state: "unavailable",
            detail: "This source could not be read just now.",
            checkedAt: null,
          },
          opportunities: [],
          setup: [],
        };
      }
    }),
  );
  return {
    opportunities: sort(
      readings.flatMap((r) => r.opportunities),
      byRank,
    ),
    setup: readings.flatMap((r) => r.setup),
    sources: readings.map((r) => r.source),
  };
}

export const OpportunitiesService = { list };
