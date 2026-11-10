import { createColumnHelper, type ColumnDef } from "@tanstack/react-table";
import type { MutableRefObject } from "react";
import { makeSelectionColumn } from "@/client/components/table/DataTable";
import { SortableHeader } from "@/client/components/table/SortableHeader";
import type { SelectionAnchor } from "@/client/components/table/tableSelection";
import { Badge } from "@/client/components/ui/badge";
import {
  formatCount,
  formatCtr,
  formatPosition,
} from "@/client/features/search-performance/SearchPerformanceColumns";
import { AskSamButton } from "@/client/features/sam/AskSamButton";
import { safeHttpUrl } from "@/shared/safe-url";
import type { getGscKeywordIdeas } from "@/serverFunctions/gscKeywordIdeas";

type GscKeywordIdeaRow = Extract<
  Awaited<ReturnType<typeof getGscKeywordIdeas>>,
  { connected: true }
>["ideas"][number];

const helper = createColumnHelper<GscKeywordIdeaRow>();
const rightAligned = {
  headerClassName: "text-right",
  cellClassName: "text-right tabular-nums",
} as const;

function askAboutQuery(row: GscKeywordIdeaRow): string {
  const page = row.page ? ` My best page for it is ${row.page}.` : "";
  return `Tell me about the Search Console query "${row.keyword}": ${formatCount(row.impressions)} impressions, ${formatCount(row.clicks)} clicks, average position ${formatPosition(row.position)}.${page} What should I change to rank higher and get more clicks for it?`;
}

export function buildGscKeywordIdeaColumns(
  anchorRef: MutableRefObject<SelectionAnchor | null>,
  projectId: string,
): ColumnDef<GscKeywordIdeaRow>[] {
  return [
    makeSelectionColumn<GscKeywordIdeaRow>(
      anchorRef,
      (row) => `Select ${row.original.keyword}`,
    ),
    helper.accessor("keyword", {
      enableSorting: false,
      header: () => "Query",
      cell: ({ row, getValue }) => (
        <span className="flex max-w-sm items-center gap-2">
          <span className="truncate" title={getValue()}>
            {getValue()}
          </span>
          {row.original.strikingDistance && (
            <Badge variant="secondary" title="Average position 5 to 20">
              Striking distance
            </Badge>
          )}
        </span>
      ),
    }),
    helper.accessor("impressions", {
      header: ({ column }) => (
        <SortableHeader
          column={column}
          label="Impressions"
          align="right"
          title="Times your site was shown for this query. Not search volume."
        />
      ),
      cell: ({ getValue }) => formatCount(getValue()),
      meta: rightAligned,
    }),
    helper.accessor("clicks", {
      header: ({ column }) => (
        <SortableHeader column={column} label="Clicks" align="right" />
      ),
      cell: ({ getValue }) => formatCount(getValue()),
      meta: rightAligned,
    }),
    helper.accessor("ctr", {
      header: ({ column }) => (
        <SortableHeader column={column} label="CTR" align="right" />
      ),
      cell: ({ getValue }) => formatCtr(getValue()),
      meta: rightAligned,
    }),
    helper.accessor("position", {
      header: ({ column }) => (
        <SortableHeader
          column={column}
          label="Avg. position"
          align="right"
          title="Average position over the impressions in this period"
        />
      ),
      cell: ({ getValue }) => formatPosition(getValue()),
      meta: rightAligned,
    }),
    helper.accessor("page", {
      enableSorting: false,
      header: () => "Best page",
      cell: ({ getValue }) => {
        const page = getValue();
        if (!page) return <span className="text-muted-foreground">-</span>;
        return (
          <a
            href={safeHttpUrl(page) ?? undefined}
            target="_blank"
            rel="noreferrer"
            className="block max-w-xs truncate text-primary underline-offset-4 hover:underline"
            title={page}
          >
            {page}
          </a>
        );
      },
    }),
    helper.display({
      id: "askSam",
      header: () => <span className="sr-only">Ask SAM</span>,
      cell: ({ row }) => (
        <AskSamButton
          projectId={projectId}
          label={`Ask SAM about "${row.original.keyword}"`}
          question={askAboutQuery(row.original)}
          size="xs"
          iconOnly
        />
      ),
    }),
  ];
}
