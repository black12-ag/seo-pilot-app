import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { PageHeader } from "@/client/components/PageHeader";
import { EmptyState } from "@/client/components/EmptyState";
import { QueryState } from "@/client/components/QueryState";
import { Alert, AlertDescription } from "@/client/components/ui/alert";
import { Button } from "@/client/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/client/components/ui/select";
import { getKeywordClusters } from "@/serverFunctions/keywordInsights";
import { aiMarketLabel } from "@/shared/ai-visibility";
import { KeywordClusterCard } from "./KeywordClusterCard";

const PAGE_SIZE = 30;

function marketValue(market: { locationCode: number; languageCode: string }) {
  return `${market.locationCode}:${market.languageCode}`;
}

function parseMarketValue(value: string) {
  const [location, languageCode] = value.split(":");
  return { locationCode: Number(location), languageCode: languageCode ?? "" };
}

type Data = Awaited<ReturnType<typeof getKeywordClusters>>;

export function KeywordClustersPage({ projectId }: { projectId: string }) {
  const [requested, setRequested] = useState<string | null>(null);
  // Removals last for this visit only. Nothing is written to the saved list.
  const [removedByMarket, setRemovedByMarket] = useState<
    Record<string, readonly string[]>
  >({});
  const query = useQuery({
    queryKey: ["keyword-clusters", projectId, requested],
    queryFn: () =>
      getKeywordClusters({
        data: {
          projectId,
          ...(requested ? parseMarketValue(requested) : {}),
        },
      }),
  });

  return (
    <div className="overflow-auto px-4 py-4 pb-24 md:px-6 md:py-6 md:pb-8">
      <div className="mx-auto max-w-5xl space-y-4">
        <PageHeader
          title="Turn demand into a plan."
          description="Group related intent without losing the keywords and pages underneath."
        />
        <QueryState
          query={query}
          errorFallback="Couldn't load your keyword groups."
        >
          {(data) => (
            <ClusterResults
              key={marketValue(data.market)}
              projectId={projectId}
              data={data}
              onMarketChange={setRequested}
              removed={removedByMarket[marketValue(data.market)] ?? []}
              onRemovedChange={(next) =>
                setRemovedByMarket((current) => ({
                  ...current,
                  [marketValue(data.market)]: next,
                }))
              }
            />
          )}
        </QueryState>
      </div>
    </div>
  );
}

function ClusterResults({
  projectId,
  data,
  onMarketChange,
  removed,
  onRemovedChange,
}: {
  projectId: string;
  data: Data;
  onMarketChange: (value: string) => void;
  removed: readonly string[];
  onRemovedChange: (next: readonly string[]) => void;
}) {
  const [visible, setVisible] = useState(PAGE_SIZE);

  const clusters = useMemo(() => {
    const hidden = new Set(removed);
    return data.clusters.flatMap((cluster) => {
      const keywords = cluster.keywords.filter(
        (row) => !hidden.has(row.keyword),
      );
      const [first] = keywords;
      if (!first) return [];
      return [
        {
          ...cluster,
          keywords,
          label: hidden.has(cluster.label) ? first.keyword : cluster.label,
        },
      ];
    });
  }, [data.clusters, removed]);

  if (data.totalKeywords === 0) {
    return (
      <EmptyState
        title="No saved keywords yet"
        description="Save keywords from research and they will be grouped here."
        action={
          <Button
            nativeButton={false}
            render={<Link to="/p/$projectId/keywords" params={{ projectId }} />}
          >
            Find keywords
          </Button>
        }
      />
    );
  }

  const value = marketValue(data.market);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
        <span className="font-medium">
          Market: {aiMarketLabel(data.market)}
        </span>
        {data.markets.length > 1 ? (
          <Select
            value={value}
            items={data.markets.map((market) => ({
              value: marketValue(market),
              label: `${aiMarketLabel(market)} (${market.keywordCount})`,
            }))}
            onValueChange={(next) => {
              if (next) onMarketChange(next);
            }}
          >
            <SelectTrigger aria-label="Choose a market" className="w-auto">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {data.markets.map((market) => (
                <SelectItem
                  key={marketValue(market)}
                  value={marketValue(market)}
                >
                  {aiMarketLabel(market)} ({market.keywordCount})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}
      </div>

      {data.isProjectMarket ? null : (
        <Alert>
          <AlertDescription>
            These keywords were saved for a different market than this project
            uses. Check that they are the right ones.
          </AlertDescription>
        </Alert>
      )}

      {data.clusteredKeywords < data.totalKeywords ? (
        <Alert>
          <AlertDescription>
            Showing groups for the top {data.clusteredKeywords.toLocaleString()}{" "}
            of {data.totalKeywords.toLocaleString()} saved keywords, by volume.
          </AlertDescription>
        </Alert>
      ) : null}

      <p className="text-sm text-muted-foreground">
        Keywords join a group when at least half of their words match its lead
        keyword, after common words and plurals are set aside. This uses no
        credits.
      </p>

      {removed.length > 0 ? (
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <span>
            {removed.length} removed for this visit. Your saved keywords have
            not changed.
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => onRemovedChange([])}
          >
            Restore all
          </Button>
        </div>
      ) : null}

      {clusters.length === 0 ? (
        <EmptyState
          kind="filtered"
          title="Every keyword was removed"
          description="Restore them to see these groups again."
        />
      ) : (
        clusters
          .slice(0, visible)
          .map((cluster) => (
            <KeywordClusterCard
              key={cluster.id}
              cluster={cluster}
              onRemove={(keyword) => onRemovedChange([...removed, keyword])}
            />
          ))
      )}

      {clusters.length > visible ? (
        <Button
          variant="outline"
          onClick={() => setVisible((current) => current + PAGE_SIZE)}
        >
          Show more groups
        </Button>
      ) : null}
    </div>
  );
}
