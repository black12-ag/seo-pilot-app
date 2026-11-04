import { useState } from "react";
import { EmptyState } from "@/client/components/EmptyState";
import { SafeExternalLink } from "@/client/components/SafeExternalLink";
import { Alert, AlertDescription } from "@/client/components/ui/alert";
import { Button } from "@/client/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/client/components/ui/table";
import type { runKeywordGap } from "@/serverFunctions/keywordInsights";
import { aiMarketLabel } from "@/shared/ai-visibility";

const PAGE_SIZE = 100;

type GapResult = Extract<
  Awaited<ReturnType<typeof runKeywordGap>>,
  { status: "ready" }
>;
type GapRow = GapResult["missing"][number];
type View = "missing" | "shared";

function PositionCell({
  ranks,
  position,
  url,
}: {
  ranks: boolean;
  position: number | null;
  url: string | null;
}) {
  if (!ranks) return <span className="text-muted-foreground">Not found</span>;
  const label = position == null ? "Unknown" : String(position);
  if (!url) return <span>{label}</span>;
  return (
    <SafeExternalLink
      url={url}
      label={label}
      className="inline-flex items-center gap-1 underline"
    />
  );
}

function known(value: number | null) {
  return value == null ? (
    <span className="text-muted-foreground">Unknown</span>
  ) : (
    value.toLocaleString()
  );
}

export function KeywordGapResults({ result }: { result: GapResult }) {
  const [view, setView] = useState<View>("missing");
  const [visible, setVisible] = useState(PAGE_SIZE);
  const rows: GapRow[] = result[view];
  const coverage = [result.project, ...result.competitors];

  return (
    <div className="space-y-4 text-sm">
      <div className="space-y-1">
        <p>
          Market:{" "}
          <span className="font-medium">{aiMarketLabel(result.market)}</span>.
          Subdomains are included.
        </p>
        <ul className="text-muted-foreground">
          {coverage.map((domain) => (
            <li key={domain.domain}>
              {domain.domain}: fetched{" "}
              {new Date(domain.fetchedAt).toLocaleDateString()},{" "}
              {domain.fetchedRows.toLocaleString()}
              {domain.totalCount == null
                ? ""
                : ` of ${domain.totalCount.toLocaleString()}`}{" "}
              ranking keywords
            </li>
          ))}
        </ul>
      </div>

      {result.project.complete ? null : (
        <Alert>
          <AlertDescription>
            We only checked your top{" "}
            {result.project.fetchedRows.toLocaleString()} keywords by traffic.
            Some keywords marked as not found may still rank for{" "}
            {result.project.domain}.
          </AlertDescription>
        </Alert>
      )}
      {result.competitors.some((domain) => !domain.complete) ? (
        <Alert>
          <AlertDescription>
            Large competitors show only their top keywords by traffic, so this
            list isn't everything they rank for.
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant={view === "missing" ? "default" : "outline"}
          aria-pressed={view === "missing"}
          onClick={() => {
            setView("missing");
            setVisible(PAGE_SIZE);
          }}
        >
          Competitors only ({result.missing.length.toLocaleString()})
        </Button>
        <Button
          size="sm"
          variant={view === "shared" ? "default" : "outline"}
          aria-pressed={view === "shared"}
          onClick={() => {
            setView("shared");
            setVisible(PAGE_SIZE);
          }}
        >
          Shared ({result.shared.length.toLocaleString()})
        </Button>
      </div>

      {rows.length === 0 ? (
        <EmptyState
          title={
            view === "missing" ? "No gaps found" : "No shared keywords found"
          }
          description="Nothing matched for these domains in this market. If that looks wrong, check the market above."
        />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Keyword</TableHead>
              <TableHead className="text-right">Volume</TableHead>
              <TableHead className="text-right">Difficulty</TableHead>
              <TableHead>{result.project.domain}</TableHead>
              {result.competitors.map((domain) => (
                <TableHead key={domain.domain}>{domain.domain}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.slice(0, visible).map((row) => (
              <TableRow key={row.keyword}>
                <TableCell className="whitespace-normal">
                  {row.keyword}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {known(row.searchVolume)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {known(row.keywordDifficulty)}
                </TableCell>
                <TableCell>
                  <PositionCell
                    ranks={row.projectRanks}
                    position={row.projectPosition}
                    url={row.projectUrl}
                  />
                </TableCell>
                {row.competitors.map((cell) => (
                  <TableCell key={cell.domain}>
                    <PositionCell {...cell} />
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      {rows.length > visible ? (
        <Button
          variant="outline"
          onClick={() => setVisible((current) => current + PAGE_SIZE)}
        >
          Show more keywords
        </Button>
      ) : null}
    </div>
  );
}
