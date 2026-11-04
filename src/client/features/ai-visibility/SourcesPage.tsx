import { useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ArrowRight, Quote } from "lucide-react";
import { EmptyState } from "@/client/components/EmptyState";
import { BackLink, PageHeader } from "@/client/components/PageHeader";
import {
  SkeletonPageContent,
  SkeletonTableRows,
} from "@/client/components/SkeletonPresets";
import { DataTableToolbar } from "@/client/components/table/DataTableToolbar";
import { Button } from "@/client/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/client/components/ui/select";
import { getAiVisibilitySourceReport } from "@/serverFunctions/ai-visibility";
import {
  aiMarketLabel,
  type AiEngine,
  type AiMarket,
  type AiSourceCohort,
} from "@/shared/ai-visibility";
import { EngineFilter } from "./EngineFilter";
import {
  PromptDateRange,
  PromptRange,
  promptPeriod,
  promptPeriodWindow,
} from "./PromptDateRange";
import {
  AI_OWNERSHIP_ITEMS,
  AiQueryError,
  aiVisibilityKey,
  useAiVisibilityTracker,
} from "./shared";
import { CohortSummary } from "./SourcesCohort";
import { SourcesTable } from "./SourcesTable";
import { SourceDetail } from "./SourceDetail";

type OwnershipFilter = (typeof AI_OWNERSHIP_ITEMS)[number]["value"];

const marketKey = (market: AiMarket) =>
  `${market.locationCode}|${market.languageCode}`;

export function SourcesPage({
  projectId,
  domain,
}: {
  projectId: string;
  domain: string | undefined;
}) {
  const tracker = useAiVisibilityTracker(projectId);
  const [period, setPeriod] = useState(() => promptPeriod());
  const [engines, setEngines] = useState<AiEngine[] | null>(null);
  const [market, setMarket] = useState<AiMarket | null>(null);
  const [ownership, setOwnership] = useState<OwnershipFilter>("all");
  const [cursor, setCursor] = useState<string | undefined>();
  const dates = promptPeriodWindow(period);
  const cohort = dates && { ...dates, engines, market };
  const report = useQuery({
    queryKey: [
      ...aiVisibilityKey(projectId),
      "sources",
      "report",
      cohort,
      ownership,
      cursor,
    ],
    queryFn: () =>
      getAiVisibilitySourceReport({
        data: { projectId, ...cohort, ownership, cursor },
      }),
    enabled: Boolean(cohort),
    placeholderData: keepPreviousData,
    // Answers still collecting change these counts; saved reads cost nothing.
    refetchInterval: (query) =>
      query.state.data?.cohort.answers.pending ? 15_000 : false,
  });
  const reset = () => setCursor(undefined);
  const data = cohort ? report.data : undefined;
  const header = (
    <PageHeader
      backLink={
        <BackLink to="/p/$projectId/ai-visibility" params={{ projectId }}>
          Prompt Tracking
        </BackLink>
      }
      title="Citations and sources"
      description="Which domains and pages your tracked answers cite, within one date window and market. Citation does not establish causation."
    />
  );
  if (tracker.isPending) return <SkeletonPageContent />;
  if (tracker.isError)
    return (
      <AiQueryError
        error={tracker.error}
        retry={() => {
          void tracker.refetch();
        }}
      />
    );
  if (!tracker.data.configured)
    return (
      <div className="space-y-4">
        {header}
        <EmptyState
          variant="card"
          icon={Quote}
          title="No tracked prompts yet"
          description="Add prompts to Prompt Tracking and run them. Their answers and sources show here."
          action={
            <Button
              nativeButton={false}
              render={
                <Link to="/p/$projectId/ai-visibility" params={{ projectId }} />
              }
            >
              Go to Prompt Tracking
            </Button>
          }
        />
      </div>
    );
  const engineOptions = [
    ...new Set([
      ...tracker.data.engines,
      ...(data?.cohort.availableEngines ?? []),
    ]),
  ];
  const markets = data?.cohort.markets ?? [];
  const chosenMarket = data?.cohort.market;
  return (
    <div className="space-y-4">
      {header}
      <div className="flex min-w-0 flex-col overflow-hidden rounded-xl border border-border bg-card shadow-sm">
        <DataTableToolbar>
          <PromptDateRange
            value={period}
            onChange={(next) => {
              setPeriod(next);
              reset();
            }}
          />
          {engineOptions.length > 1 && (
            <EngineFilter
              label="Filter sources by engine"
              engines={engineOptions}
              value={engines ?? engineOptions}
              onChange={(next) => {
                setEngines(next);
                reset();
              }}
            />
          )}
          {markets.length > 1 && chosenMarket && (
            <MarketFilter
              markets={markets}
              value={chosenMarket}
              onChange={(next) => {
                setMarket(next);
                reset();
              }}
            />
          )}
          {!domain && (
            <Select
              items={AI_OWNERSHIP_ITEMS}
              value={ownership}
              onValueChange={(value) => {
                const item = AI_OWNERSHIP_ITEMS.find(
                  (option) => option.value === value,
                );
                if (item) setOwnership(item.value);
                reset();
              }}
            >
              <SelectTrigger size="sm" aria-label="Filter source ownership">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {AI_OWNERSHIP_ITEMS.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </DataTableToolbar>
        {!cohort ? (
          <p className="p-10 text-center text-sm text-muted-foreground">
            Choose a valid date range.
          </p>
        ) : engines?.length === 0 ? (
          <p className="p-10 text-center text-sm text-muted-foreground">
            Choose at least one engine.
          </p>
        ) : report.isPending ? (
          <SkeletonTableRows rows={6} columns={5} className="p-4" />
        ) : report.isError ? (
          <AiQueryError
            error={report.error}
            retry={() => {
              void report.refetch();
            }}
          />
        ) : domain ? (
          <SourceDetail
            // Each set of filters starts on the first page of answers.
            key={`${domain}:${JSON.stringify(cohort)}`}
            projectId={projectId}
            domain={domain}
            cohort={cohort}
            period={period}
          />
        ) : (
          <>
            <CohortSummary cohort={report.data.cohort} period={period} />
            <SourcesTable
              projectId={projectId}
              period={period}
              cohort={report.data.cohort}
              rows={report.data.rows}
              totalCount={report.data.totalCount}
              ownership={ownership}
              providerConfigured={tracker.data.providerConfigured}
              onShowAll={() => {
                setPeriod(promptPeriod(PromptRange.All));
                reset();
              }}
            />
            {(cursor || report.data.nextCursor) && (
              <div className="flex justify-end gap-2 border-t p-3 border-border">
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={!cursor}
                  onClick={reset}
                >
                  First page
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={!report.data.nextCursor}
                  onClick={() => setCursor(report.data.nextCursor ?? undefined)}
                >
                  Next page <ArrowRight />
                </Button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function MarketFilter({
  markets,
  value,
  onChange,
}: {
  markets: AiSourceCohort["markets"];
  value: AiMarket;
  onChange: (market: AiMarket) => void;
}) {
  const items = markets.map((market) => ({
    value: marketKey(market),
    label: aiMarketLabel(market),
  }));
  return (
    <Select
      items={items}
      value={marketKey(value)}
      onValueChange={(next) => {
        const market = markets.find((item) => marketKey(item) === next);
        if (market)
          onChange({
            locationCode: market.locationCode,
            languageCode: market.languageCode,
          });
      }}
    >
      <SelectTrigger size="sm" aria-label="Market">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {items.map((item) => (
          <SelectItem key={item.value} value={item.value}>
            {item.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
