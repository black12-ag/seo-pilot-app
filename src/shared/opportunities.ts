export type OpportunityType =
  | "technical"
  | "content"
  | "ai_visibility"
  | "setup";
export type OpportunitySeverity = "high" | "medium" | "low";
export type OpportunityEffort = "small" | "medium" | "large";
export type OpportunityStatus = "open" | "needs_setup";
export type OpportunitySourceId =
  | "site_audit"
  | "search_console"
  | "ai_visibility"
  | "competitors";

/** Where the saved evidence lives. The client maps each page to a route. */
export type OpportunityTarget =
  | { page: "audit"; auditId?: string }
  | { page: "overview" }
  | { page: "search_performance" }
  | { page: "ai_visibility" }
  | { page: "ai_prompt"; promptId: string }
  | { page: "context" };

export type OpportunityEvidenceItem = {
  label: string;
  detail?: string;
  /** A saved web address. Treat it as untrusted text. */
  url?: string;
  target?: OpportunityTarget;
};

export type OpportunityEvidence = {
  source: string;
  summary: string;
  observedAt: string | null;
  items: OpportunityEvidenceItem[];
  /** Affected items not listed in `items`. */
  moreCount: number;
  link: { label: string; target: OpportunityTarget };
};

export type Opportunity = {
  id: string;
  type: OpportunityType;
  title: string;
  whyItMatters: string;
  nextStep: string;
  /** Null for setup work, which is not a measured problem. */
  severity: OpportunitySeverity | null;
  affected: { count: number; unit: "page" | "query" | "prompt" } | null;
  effort: OpportunityEffort;
  status: OpportunityStatus;
  evidence: OpportunityEvidence;
};

export type OpportunitySource = {
  id: OpportunitySourceId;
  label: string;
  /** Only `checked` means the source was read and can support "no problems". */
  state: "checked" | "not_checked" | "needs_setup" | "unavailable";
  detail: string;
  checkedAt: string | null;
  link: { label: string; target: OpportunityTarget };
};

export type OpportunitiesResult = {
  opportunities: Opportunity[];
  setup: Opportunity[];
  sources: OpportunitySource[];
};

export const OPPORTUNITY_RANKING_RULE =
  "Ranked by severity, then by how many pages, queries or prompts are affected, then by title. There is no hidden score.";

export const OPPORTUNITY_EFFORT_RULE =
  "Effort is an estimate. Technical work is small up to 10 pages, medium up to 100, and large above that. Content and AI visibility work is medium. Setup is small.";
