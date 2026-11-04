import { useQuery } from "@tanstack/react-query";
import { EmptyState } from "@/client/components/EmptyState";
import { PageHeader, SectionHeader } from "@/client/components/PageHeader";
import { QueryState } from "@/client/components/QueryState";
import { SkeletonTableRows } from "@/client/components/SkeletonPresets";
import { Badge } from "@/client/components/ui/badge";
import { formatDate } from "@/client/features/audit/shared";
import {
  OPPORTUNITY_EFFORT_RULE,
  OPPORTUNITY_RANKING_RULE,
  type OpportunitiesResult,
  type OpportunitySource,
} from "@/shared/opportunities";
import { getOpportunities } from "@/serverFunctions/opportunities";
import {
  OpportunityRow,
  OpportunityTargetLink,
  SetupRow,
} from "./OpportunityRows";

const LIST_CLASS =
  "divide-y divide-border overflow-hidden rounded-xl border border-border bg-card";

export function OpportunitiesPage({ projectId }: { projectId: string }) {
  const query = useQuery({
    queryKey: ["opportunities", projectId],
    queryFn: () => getOpportunities({ data: { projectId } }),
  });
  return (
    <div className="h-full overflow-auto px-4 py-4 pb-24 md:px-6 md:py-6 md:pb-8">
      <div className="mx-auto max-w-7xl space-y-8">
        <PageHeader
          title="Good evidence. Useful work."
          description="Turn findings and gaps into a small, measurable plan."
        />
        <QueryState
          query={query}
          errorFallback="Could not load opportunities. Try again."
          loading={<OpportunitiesLoading />}
        >
          {(data) => <OpportunitiesContent projectId={projectId} data={data} />}
        </QueryState>
      </div>
    </div>
  );
}

function OpportunitiesLoading() {
  return (
    <div className="rounded-xl border border-border bg-card p-4" aria-busy>
      <SkeletonTableRows rows={6} columns={4} />
    </div>
  );
}

function OpportunitiesContent({
  projectId,
  data,
}: {
  projectId: string;
  data: OpportunitiesResult;
}) {
  // Saved competitors feed comparisons but measure nothing on their own, so
  // they can't support a "no problems" message.
  const measuring = data.sources.filter((s) => s.id !== "competitors");
  const unchecked = measuring.filter((s) => s.state !== "checked");
  const checkedAny = unchecked.length < measuring.length;
  return (
    <>
      <section className="space-y-3">
        <SectionHeader
          title="What to do next"
          hint={`${OPPORTUNITY_RANKING_RULE} ${OPPORTUNITY_EFFORT_RULE}`}
        />
        {unchecked.length ? <CoverageNote sources={unchecked} /> : null}
        {data.opportunities.length ? (
          <div className={LIST_CLASS}>
            {data.opportunities.map((opportunity) => (
              <OpportunityRow
                key={opportunity.id}
                projectId={projectId}
                opportunity={opportunity}
              />
            ))}
          </div>
        ) : checkedAny ? (
          <EmptyState
            title="Nothing to fix in what was checked"
            description={
              unchecked.length
                ? "This covers only the sources checked so far. The others could still hold problems."
                : "The latest saved results from every source show nothing to act on."
            }
          />
        ) : (
          <EmptyState
            title="Nothing has been checked yet"
            description="This does not mean your site has no problems. Finish the setup below so there is evidence to work from."
          />
        )}
      </section>

      {data.setup.length ? (
        <section className="space-y-3">
          <SectionHeader
            title="Finish setup"
            hint="These are not problems with your site. They let SEO Pilot check more."
          />
          <div className={LIST_CLASS}>
            {data.setup.map((opportunity) => (
              <SetupRow
                key={opportunity.id}
                projectId={projectId}
                opportunity={opportunity}
              />
            ))}
          </div>
        </section>
      ) : null}

      <section className="space-y-3">
        <SectionHeader title="What was checked" />
        <div className={LIST_CLASS}>
          {data.sources.map((source) => (
            <SourceRow key={source.id} projectId={projectId} source={source} />
          ))}
        </div>
      </section>
    </>
  );
}

function CoverageNote({ sources }: { sources: OpportunitySource[] }) {
  const names = (state: (s: OpportunitySource) => boolean) =>
    sources
      .filter(state)
      .map((s) => s.label)
      .join(", ");
  const failed = names((s) => s.state === "unavailable");
  const missing = names((s) => s.state !== "unavailable");
  return (
    <p className="text-sm text-muted-foreground">
      {missing ? `Not checked yet: ${missing}. ` : ""}
      {failed ? `Could not read: ${failed}.` : ""}
    </p>
  );
}

const SOURCE_BADGE = {
  checked: { label: "Checked", variant: "success" },
  not_checked: { label: "Not checked yet", variant: "outline" },
  needs_setup: { label: "Not checked yet, needs setup", variant: "outline" },
  unavailable: { label: "Could not read", variant: "warning" },
} as const;

function SourceRow({
  projectId,
  source,
}: {
  projectId: string;
  source: OpportunitySource;
}) {
  const badge = SOURCE_BADGE[source.state];
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 p-4">
      <div className="min-w-0 flex-1 basis-64 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium">{source.label}</span>
          <Badge variant={badge.variant}>{badge.label}</Badge>
        </div>
        <p className="text-sm text-muted-foreground">
          {source.detail}
          {source.checkedAt ? ` ${formatDate(source.checkedAt)}.` : ""}
        </p>
      </div>
      <OpportunityTargetLink
        projectId={projectId}
        target={source.link.target}
        className="text-sm font-medium text-primary underline-offset-4 hover:underline"
      >
        {source.link.label}
      </OpportunityTargetLink>
    </div>
  );
}
