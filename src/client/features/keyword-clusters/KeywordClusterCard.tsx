import { X } from "lucide-react";
import { SafeExternalLink } from "@/client/components/SafeExternalLink";
import { Badge } from "@/client/components/ui/badge";
import { Button } from "@/client/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/client/components/ui/card";
import {
  summarizeCluster,
  type ClusterKeyword,
} from "@/shared/keywordClusters";

const SUGGESTED_PAGE: Record<string, string> = {
  informational: "Guide or how-to article",
  commercial: "Comparison or best-of page",
  transactional: "Product or pricing page",
  navigational: "Brand or landing page",
};

type Cluster = {
  id: string;
  label: string;
  keywords: ClusterKeyword[];
  trackedKeywords: string[];
  pages: Array<{ url: string; role: string; topic: string | null }>;
};

function volumeText(totalVolume: number | null, known: number, count: number) {
  if (totalVolume == null) return "Volume unknown";
  const total = totalVolume.toLocaleString();
  return known === count
    ? `${total} searches a month`
    : `${total} searches a month (known for ${known} of ${count})`;
}

export function KeywordClusterCard({
  cluster,
  onRemove,
}: {
  cluster: Cluster;
  onRemove: (keyword: string) => void;
}) {
  const summary = summarizeCluster(cluster.keywords);
  const suggestedPage = summary.intent
    ? (SUGGESTED_PAGE[summary.intent] ?? null)
    : null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>{cluster.label}</CardTitle>
        <CardDescription>
          {summary.keywordCount}{" "}
          {summary.keywordCount === 1 ? "keyword" : "keywords"} ·{" "}
          {volumeText(
            summary.totalVolume,
            summary.volumeKnownCount,
            summary.keywordCount,
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <dl className="grid gap-1 sm:grid-cols-[10rem_1fr]">
          <dt className="text-muted-foreground">Suggested page</dt>
          <dd>
            {suggestedPage
              ? `${suggestedPage} (${summary.intent}, from ${summary.intentKeywordCount} of ${summary.keywordCount})`
              : "Unknown. No intent data yet."}
          </dd>
          <dt className="text-muted-foreground">Tracked keywords</dt>
          <dd>
            {cluster.trackedKeywords.length > 0
              ? cluster.trackedKeywords.join(", ")
              : "None yet"}
          </dd>
          <dt className="text-muted-foreground">Saved pages</dt>
          <dd className="space-y-1">
            {cluster.pages.length > 0
              ? cluster.pages.map((page) => (
                  <SafeExternalLink
                    key={page.url}
                    url={page.url}
                    label={page.topic ?? page.url}
                    className="flex items-center gap-1 break-all underline"
                  />
                ))
              : "No matching page yet"}
          </dd>
        </dl>
        <ul className="divide-y rounded-lg border">
          {cluster.keywords.map((row) => (
            <li
              key={row.keyword}
              className="flex flex-wrap items-center gap-2 px-3 py-1.5"
            >
              <span className="min-w-0 flex-1 break-words">{row.keyword}</span>
              {row.tracked ? <Badge variant="secondary">Tracked</Badge> : null}
              <span className="text-muted-foreground tabular-nums">
                {row.searchVolume == null
                  ? "Unknown"
                  : row.searchVolume.toLocaleString()}
              </span>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={`Remove ${row.keyword} from this view`}
                onClick={() => onRemove(row.keyword)}
              >
                <X />
              </Button>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
