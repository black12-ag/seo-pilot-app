import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Globe, Info } from "lucide-react";
import { EmptyState } from "@/client/components/EmptyState";
import { PageHeader } from "@/client/components/PageHeader";
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@/client/components/ui/alert";
import { Button } from "@/client/components/ui/button";
import { Card, CardContent } from "@/client/components/ui/card";
import { Input } from "@/client/components/ui/input";
import { Skeleton } from "@/client/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCard,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/client/components/ui/table";
import { dataforseoHelpLinkOptions } from "@/client/navigation/items";
import { getFreeBacklinks } from "@/serverFunctions/freeBacklinks";
import type {
  FreeBacklinksSelected,
  FreeBacklinksTracked,
} from "@/types/schemas/freeBacklinks";
import { crawlPeriodLabel, shortDate } from "./freeBacklinksLabels";

const PAGE_SIZE = 100;
const DOCS_URL =
  "https://github.com/black12-ag/seo-pilot-app/blob/main/docs/FREE_BACKLINKS.md";

type ReadySelection = Extract<FreeBacklinksSelected, { status: "ready" }>;

/**
 * Backlinks with no DataForSEO key: the referring domains Common Crawl's public
 * web graph has for the project's site and competitors, prepared on this server.
 */
export function FreeBacklinksPage({
  projectId,
  target,
  onTargetChange,
}: {
  projectId: string;
  target: string;
  onTargetChange: (target: string) => void;
}) {
  const query = useQuery({
    queryKey: ["freeBacklinks", projectId, target],
    queryFn: () =>
      getFreeBacklinks({ data: { projectId, target: target || undefined } }),
  });
  const selected = query.data?.selected ?? null;

  return (
    <div className="px-4 py-4 pb-24 overflow-auto md:px-6 md:py-6 md:pb-8">
      <div className="mx-auto max-w-5xl space-y-4">
        <PageHeader
          title="Backlinks"
          description="Which sites link to your site and your competitors, from free public crawl data."
        />
        <SourceNotice ready={selected?.status === "ready" ? selected : null} />
        {query.isPending ? (
          <Skeleton className="h-64 w-full" />
        ) : query.isError ? (
          <EmptyState
            kind="error"
            variant="card"
            title="Couldn't load backlink data"
            description="Reload the page to try again."
          />
        ) : (
          <>
            <DomainPicker
              tracked={query.data.tracked}
              selected={selected?.domain ?? null}
              onSelect={onTargetChange}
            />
            <SelectedDomain projectId={projectId} selected={selected} />
          </>
        )}
      </div>
    </div>
  );
}

function SourceNotice({ ready }: { ready: ReadySelection | null }) {
  const period = ready ? crawlPeriodLabel(ready.release) : null;
  return (
    <Alert variant="info">
      <Info />
      <AlertTitle>
        Free data from Common Crawl&apos;s web graph: domain-level, sampled and
        a few months old.
      </AlertTitle>
      <AlertDescription>
        <p>
          It lists sites that link to a domain from at least one page, not
          single links or pages. Common Crawl samples the web, so counts are
          lower than paid tools find, and new links appear only in a later
          release.
          {ready ? (
            <>
              {" "}
              Release <span className="font-medium">{ready.release}</span>
              {period ? ` (crawled ${period})` : ""}
              {ready.publishedAt
                ? `, published ${shortDate(ready.publishedAt)}`
                : ""}
              , prepared here {shortDate(ready.importedAt)}.
            </>
          ) : null}
        </p>
        <p className="mt-1">
          For single links, anchor text and changes, add an optional{" "}
          <Link {...dataforseoHelpLinkOptions} className="underline">
            DataForSEO key
          </Link>
          .
        </p>
      </AlertDescription>
    </Alert>
  );
}

function DomainPicker({
  tracked,
  selected,
  onSelect,
}: {
  tracked: FreeBacklinksTracked[];
  selected: string | null;
  onSelect: (domain: string) => void;
}) {
  if (tracked.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-2" role="group" aria-label="Domain">
      {tracked.map((item) => (
        <Button
          key={item.domain}
          size="sm"
          variant={item.domain === selected ? "default" : "outline"}
          aria-pressed={item.domain === selected}
          onClick={() => onSelect(item.domain)}
        >
          {item.domain}
          <span className="text-xs opacity-75">
            {item.role === "site" ? "your site" : "competitor"}
            {item.referringDomains === null
              ? ""
              : ` · ${item.referringDomains.toLocaleString()}`}
          </span>
        </Button>
      ))}
    </div>
  );
}

function SelectedDomain({
  projectId,
  selected,
}: {
  projectId: string;
  selected: FreeBacklinksSelected | null;
}) {
  if (!selected) {
    return (
      <EmptyState
        variant="card"
        icon={Globe}
        title="Add your website to this project"
        description="Free backlink data covers the project's site and its competitors."
        action={
          <Button
            variant="outline"
            nativeButton={false}
            render={<Link to="/p/$projectId/settings" params={{ projectId }} />}
          >
            Project settings
          </Button>
        }
      />
    );
  }
  if (selected.status === "not_tracked") {
    return (
      <EmptyState
        variant="card"
        title={`${selected.domain} isn't tracked in this project`}
        description="Free data covers the project's site and its competitors. Add it as a competitor on the Context page; it's included from the next refresh."
      />
    );
  }
  if (selected.status === "not_prepared") {
    return (
      <EmptyState
        variant="card"
        title={`No free data for ${selected.domain} yet`}
        description={
          <>
            The server owner prepares it with one command, then once a month.
            See{" "}
            <a
              className="underline"
              href={DOCS_URL}
              target="_blank"
              rel="noreferrer"
            >
              free backlinks
            </a>
            .
          </>
        }
      />
    );
  }
  return <ReferrerList selected={selected} />;
}

function ReferrerList({ selected }: { selected: ReadySelection }) {
  const [filter, setFilter] = useState("");
  const [page, setPage] = useState(0);
  const rows = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    return needle
      ? selected.referrers.filter((row) => row.domain.includes(needle))
      : selected.referrers;
  }, [filter, selected.referrers]);
  const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const current = Math.min(page, pageCount - 1);
  const visible = rows.slice(current * PAGE_SIZE, (current + 1) * PAGE_SIZE);
  const listed = selected.referrers.length;

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-sm text-muted-foreground">
              Referring domains to {selected.domain}
            </p>
            <p className="text-3xl font-semibold tabular-nums">
              {selected.referringDomains.toLocaleString()}
            </p>
          </div>
          <p className="max-w-sm text-sm text-muted-foreground">
            {listed < selected.referringDomains
              ? `Listing the ${listed.toLocaleString()} with the most hosts.`
              : "Listing all of them, most hosts first."}{" "}
            Hosts is how many subdomains of that site the crawl saw, a rough
            sign of its size.
          </p>
        </CardContent>
      </Card>
      {listed === 0 ? (
        <EmptyState
          variant="card"
          title="No linking domains in this release"
          description="Common Crawl didn't find a site linking here. A small or new site often isn't in its sample yet."
        />
      ) : (
        <TableCard>
          <div className="border-b border-border p-3">
            <Input
              aria-label="Filter domains"
              placeholder="Filter domains"
              value={filter}
              onChange={(event) => {
                setFilter(event.target.value);
                setPage(0);
              }}
              className="max-w-xs"
            />
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-16">#</TableHead>
                <TableHead>Referring domain</TableHead>
                <TableHead className="w-28 text-right">Hosts</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visible.map((row, index) => (
                <TableRow key={row.domain}>
                  <TableCell className="tabular-nums text-muted-foreground">
                    {current * PAGE_SIZE + index + 1}
                  </TableCell>
                  <TableCell className="font-medium">{row.domain}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {row.hosts.toLocaleString()}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <div className="flex items-center justify-between gap-2 border-t border-border p-3 text-sm text-muted-foreground">
            <span>
              {rows.length.toLocaleString()} shown · page {current + 1} of{" "}
              {pageCount}
            </span>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={current === 0}
                onClick={() => setPage(current - 1)}
              >
                Previous
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={current >= pageCount - 1}
                onClick={() => setPage(current + 1)}
              >
                Next
              </Button>
            </div>
          </div>
        </TableCard>
      )}
    </div>
  );
}
