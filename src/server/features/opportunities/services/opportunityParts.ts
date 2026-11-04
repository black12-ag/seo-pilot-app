import { formatCount } from "@/shared/format";
import type {
  Opportunity,
  OpportunitySource,
  OpportunitySourceId,
} from "@/shared/opportunities";

export type SourceReading = {
  source: OpportunitySource;
  opportunities: Opportunity[];
  setup: Opportunity[];
};

export type SourceInput = { projectId: string; organizationId: string };

export const SAMPLE_SIZE = 5;

export const SOURCE_META = {
  site_audit: {
    id: "site_audit",
    label: "Site audit",
    link: { label: "Open site audit", target: { page: "audit" } },
  },
  search_console: {
    id: "search_console",
    label: "Search Console",
    link: {
      label: "Open Search Performance",
      target: { page: "search_performance" },
    },
  },
  ai_visibility: {
    id: "ai_visibility",
    label: "AI visibility",
    link: { label: "Open AI visibility", target: { page: "ai_visibility" } },
  },
  competitors: {
    id: "competitors",
    label: "Competitors",
    link: { label: "Open Context", target: { page: "context" } },
  },
} satisfies Record<
  OpportunitySourceId,
  Pick<OpportunitySource, "id" | "label" | "link">
>;

export function plural(count: number, one: string, many = `${one}s`) {
  return `${formatCount(count)} ${count === 1 ? one : many}`;
}

/** Setup work: never carries a severity, so it can't read as a defect. */
export function setupNudge(
  input: Pick<Opportunity, "id" | "title" | "whyItMatters" | "nextStep"> & {
    evidence: Opportunity["evidence"];
  },
): Opportunity {
  return {
    ...input,
    type: "setup",
    severity: null,
    affected: null,
    effort: "small",
    status: "needs_setup",
  };
}
