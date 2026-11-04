import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { ChevronRight } from "lucide-react";
import { Badge } from "@/client/components/ui/badge";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/client/components/ui/collapsible";
import { formatDate } from "@/client/features/audit/shared";
import { formatCount } from "@/shared/format";
import { safeHttpUrl } from "@/shared/safe-url";
import type {
  Opportunity,
  OpportunityEvidence,
  OpportunityEvidenceItem,
  OpportunitySeverity,
  OpportunityTarget,
  OpportunityType,
} from "@/shared/opportunities";

const LINK_CLASS =
  "text-sm font-medium text-primary underline-offset-4 hover:underline";

const TYPE_LABEL: Record<OpportunityType, string> = {
  technical: "Technical",
  content: "Content",
  ai_visibility: "AI visibility",
  setup: "Setup",
};

const SEVERITY_BADGE = {
  high: { label: "High priority", variant: "destructive" },
  medium: { label: "Medium priority", variant: "warning" },
  low: { label: "Low priority", variant: "secondary" },
} as const satisfies Record<OpportunitySeverity, object>;

const EFFORT_LABEL = { small: "Small", medium: "Medium", large: "Large" };

const STATUS_LABEL = { open: "Open", needs_setup: "Needs setup" };

const UNIT_PLURAL = { page: "pages", query: "queries", prompt: "prompts" };

function affectedLabel(affected: NonNullable<Opportunity["affected"]>) {
  const unit =
    affected.count === 1 ? affected.unit : UNIT_PLURAL[affected.unit];
  return `${formatCount(affected.count)} ${unit}`;
}

export function OpportunityTargetLink({
  projectId,
  target,
  className,
  children,
}: {
  projectId: string;
  target: OpportunityTarget;
  className?: string;
  children: ReactNode;
}) {
  const params = { projectId };
  switch (target.page) {
    case "audit":
      return (
        <Link
          to="/p/$projectId/audit"
          params={params}
          search={{ auditId: target.auditId, tab: "issues" }}
          className={className}
        >
          {children}
        </Link>
      );
    case "overview":
      return (
        <Link
          to="/p/$projectId"
          params={params}
          search={{ tab: "keywords" }}
          className={className}
        >
          {children}
        </Link>
      );
    case "search_performance":
      return (
        <Link
          to="/p/$projectId/search-performance"
          params={params}
          className={className}
        >
          {children}
        </Link>
      );
    case "ai_visibility":
      return (
        <Link
          to="/p/$projectId/ai-visibility"
          params={params}
          className={className}
        >
          {children}
        </Link>
      );
    case "ai_prompt":
      return (
        <Link
          to="/p/$projectId/ai-visibility/prompts/$promptId"
          params={{ projectId, promptId: target.promptId }}
          className={className}
        >
          {children}
        </Link>
      );
    case "context":
      return (
        <Link to="/p/$projectId/context" params={params} className={className}>
          {children}
        </Link>
      );
  }
}

function EvidenceItem({
  projectId,
  item,
}: {
  projectId: string;
  item: OpportunityEvidenceItem;
}) {
  // Saved addresses come from crawled pages, so only web links become links.
  const url = item.url ? safeHttpUrl(item.url) : null;
  const labelClass = "text-sm break-words";
  return (
    <li className="min-w-0">
      {item.target ? (
        <OpportunityTargetLink
          projectId={projectId}
          target={item.target}
          className={`${labelClass} text-primary underline-offset-4 hover:underline`}
        >
          {item.label}
        </OpportunityTargetLink>
      ) : url ? (
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer nofollow"
          className={`${labelClass} text-primary underline-offset-4 hover:underline`}
        >
          {item.label}
        </a>
      ) : (
        <span className={labelClass}>{item.label}</span>
      )}
      {item.detail ? (
        <p className="text-xs text-muted-foreground">{item.detail}</p>
      ) : null}
    </li>
  );
}

function Evidence({
  projectId,
  evidence,
}: {
  projectId: string;
  evidence: OpportunityEvidence;
}) {
  return (
    <div className="space-y-2">
      <h3 className="text-sm font-medium">Evidence</h3>
      <p className="text-sm text-muted-foreground">
        {evidence.source}
        {evidence.observedAt
          ? `, ${formatDate(evidence.observedAt)}`
          : ""}. {evidence.summary}
      </p>
      {evidence.items.length ? (
        <ul className="space-y-1.5">
          {evidence.items.map((item) => (
            <EvidenceItem key={item.label} projectId={projectId} item={item} />
          ))}
        </ul>
      ) : null}
      {evidence.moreCount ? (
        <p className="text-xs text-muted-foreground">
          And {formatCount(evidence.moreCount)} more.
        </p>
      ) : null}
      <OpportunityTargetLink
        projectId={projectId}
        target={evidence.link.target}
        className={LINK_CLASS}
      >
        {evidence.link.label}
      </OpportunityTargetLink>
    </div>
  );
}

function Explanation({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1">
      <h3 className="text-sm font-medium">{title}</h3>
      <p className="text-sm text-muted-foreground">{children}</p>
    </div>
  );
}

export function OpportunityRow({
  projectId,
  opportunity,
}: {
  projectId: string;
  opportunity: Opportunity;
}) {
  const severity = opportunity.severity
    ? SEVERITY_BADGE[opportunity.severity]
    : null;
  return (
    <Collapsible>
      <CollapsibleTrigger className="group flex w-full cursor-pointer items-start gap-3 p-4 text-left hover:bg-muted/50">
        <ChevronRight
          className="mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform group-data-[panel-open]:rotate-90"
          aria-hidden
        />
        <span className="min-w-0 flex-1 space-y-1">
          <span className="block text-sm font-medium">{opportunity.title}</span>
          <span className="block text-xs text-muted-foreground">
            {TYPE_LABEL[opportunity.type]}
            {opportunity.affected
              ? ` · ${affectedLabel(opportunity.affected)}`
              : ""}
            {` · Effort: ${EFFORT_LABEL[opportunity.effort]}`}
            {` · ${STATUS_LABEL[opportunity.status]}`}
          </span>
        </span>
        {severity ? (
          <Badge variant={severity.variant}>{severity.label}</Badge>
        ) : null}
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="grid gap-4 px-4 pb-4 pl-11 md:grid-cols-2">
          <div className="space-y-4">
            <Explanation title="Why it matters">
              {opportunity.whyItMatters}
            </Explanation>
            <Explanation title="What to do">{opportunity.nextStep}</Explanation>
          </div>
          <Evidence projectId={projectId} evidence={opportunity.evidence} />
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

/** Setup work stays open and carries no priority: it is not a measured problem. */
export function SetupRow({
  projectId,
  opportunity,
}: {
  projectId: string;
  opportunity: Opportunity;
}) {
  return (
    <div className="grid gap-4 p-4 md:grid-cols-2">
      <div className="space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-sm font-medium">{opportunity.title}</h3>
          <Badge variant="outline">{STATUS_LABEL[opportunity.status]}</Badge>
        </div>
        <p className="text-sm text-muted-foreground">
          {opportunity.whyItMatters}
        </p>
        <p className="text-sm text-muted-foreground">{opportunity.nextStep}</p>
        <p className="text-xs text-muted-foreground">
          Effort: {EFFORT_LABEL[opportunity.effort]}
        </p>
      </div>
      <Evidence projectId={projectId} evidence={opportunity.evidence} />
    </div>
  );
}
