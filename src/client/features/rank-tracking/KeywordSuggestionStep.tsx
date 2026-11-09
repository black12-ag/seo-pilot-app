import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  type ColumnDef,
  type RowSelectionState,
  type SortingState,
} from "@tanstack/react-table";
import { toast } from "sonner";
import { getDomainKeywordSuggestions } from "@/serverFunctions/domain";
import { getGscKeywordIdeas } from "@/serverFunctions/gscKeywordIdeas";
import { addTrackingKeywords } from "@/serverFunctions/rank-tracking";
import { isLabsLocationCode } from "@/client/features/keywords/locations";
import { Spinner } from "@/client/components/Spinner";
import {
  DataTable,
  makeSelectionColumn,
  useDataTable,
} from "@/client/components/table/DataTable";
import { Button } from "@/client/components/ui/button";
import {
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/client/components/ui/dialog";
import { SortableHeader } from "@/client/components/table/SortableHeader";
import { RANK_TRACKING_HEADER_CLASS } from "./RankTrackingColumns";
import {
  applyShiftRangeSelection,
  type SelectionAnchor,
} from "@/client/components/table/tableSelection";

type SuggestedKeyword = {
  keyword: string;
  position: number | null;
  searchVolume: number | null;
  traffic: number | null;
};

const PRE_SELECT_COUNT = 20;
// Mirrors GSC_RANK_BACKFILL_DAYS on the server.
const GSC_BACKFILL_DAYS = 30;

// Search Console suggestions carry impressions and clicks in the volume and
// traffic slots, labelled as what they are.
const buildBaseColumns = (gsc: boolean): ColumnDef<SuggestedKeyword>[] => [
  {
    id: "keyword",
    accessorKey: "keyword",
    header: ({ column }) => (
      <SortableHeader
        column={column}
        label="Keyword"
        title="The search term this domain ranks for"
        className={RANK_TRACKING_HEADER_CLASS}
      />
    ),
    cell: ({ getValue }) => (
      <span className="font-medium">{getValue<string>()}</span>
    ),
    sortingFn: "alphanumeric",
  },
  {
    id: "position",
    accessorKey: "position",
    header: ({ column }) => (
      <SortableHeader
        column={column}
        label={gsc ? "Avg. position" : "Position"}
        title={
          gsc
            ? "Average position over the last 28 days of impressions"
            : "Current Google ranking position"
        }
        className={RANK_TRACKING_HEADER_CLASS}
      />
    ),
    cell: ({ getValue }) => {
      const pos = getValue<number | null>();
      return pos != null ? (
        pos
      ) : (
        <span className="text-muted-foreground">—</span>
      );
    },
    sortingFn: (rowA, rowB) => {
      const a = rowA.original.position ?? 999;
      const b = rowB.original.position ?? 999;
      return a - b;
    },
  },
  {
    id: "searchVolume",
    accessorKey: "searchVolume",
    header: ({ column }) => (
      <SortableHeader
        column={column}
        label={gsc ? "Impressions" : "Volume"}
        title={
          gsc
            ? "Times your site was shown for it in the last 28 days. Not search volume."
            : "Monthly search volume"
        }
        className={RANK_TRACKING_HEADER_CLASS}
      />
    ),
    cell: ({ getValue }) => {
      const vol = getValue<number | null>();
      return vol != null ? (
        vol.toLocaleString()
      ) : (
        <span className="text-muted-foreground">—</span>
      );
    },
    sortingFn: (rowA, rowB) => {
      const a = rowA.original.searchVolume ?? 0;
      const b = rowB.original.searchVolume ?? 0;
      return a - b;
    },
  },
  {
    id: "traffic",
    accessorKey: "traffic",
    header: ({ column }) => (
      <SortableHeader
        column={column}
        label={gsc ? "Clicks" : "Traffic"}
        title={
          gsc
            ? "Clicks from Google in the last 28 days"
            : "Estimated monthly organic traffic"
        }
        className={RANK_TRACKING_HEADER_CLASS}
      />
    ),
    cell: ({ getValue }) => {
      const traffic = getValue<number | null>();
      return traffic != null ? (
        Math.round(traffic).toLocaleString()
      ) : (
        <span className="text-muted-foreground">—</span>
      );
    },
    sortingFn: (rowA, rowB) => {
      const a = rowA.original.traffic ?? 0;
      const b = rowB.original.traffic ?? 0;
      return a - b;
    },
  },
];

type Props = {
  configId: string;
  projectId: string;
  domain: string;
  locationCode: number;
  /** "gsc" suggests the site's own Search Console queries (free). */
  source?: "dataforseo" | "gsc";
  onDone: (configId: string) => void;
  onClose: () => void;
};

export function KeywordSuggestionStep({
  configId,
  projectId,
  domain,
  locationCode,
  source = "dataforseo",
  onDone,
  onClose,
}: Props) {
  const gsc = source === "gsc";
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  const [hasInitialized, setHasInitialized] = useState(false);
  const [sorting, setSorting] = useState<SortingState>([
    { id: "traffic", desc: true },
  ]);
  const selectAnchorRef = useRef<SelectionAnchor | null>(null);

  const columns = useMemo<ColumnDef<SuggestedKeyword>[]>(
    () => [
      makeSelectionColumn<SuggestedKeyword>(selectAnchorRef),
      ...buildBaseColumns(gsc),
    ],
    [gsc],
  );

  // Ranked-keyword suggestions are Labs-backed; countries served from Google
  // Ads keyword data (e.g. Iceland) have no ranking data to suggest from.
  // The tracker's language is deliberately not sent — rank tracking can pair
  // any SERP language with any country, and the server resolves a Labs-served
  // language for this country (resolveLabsMarket in serverFunctions/domain.ts).
  const labsSupported = gsc || isLabsLocationCode(locationCode);
  const suggestionsQuery = useQuery({
    queryKey: gsc
      ? ["gscRankSuggestions", projectId]
      : ["domainKeywordSuggestions", projectId, domain, locationCode],
    queryFn: async (): Promise<SuggestedKeyword[]> => {
      if (!gsc) {
        return getDomainKeywordSuggestions({
          data: { projectId, domain, locationCode },
        });
      }
      const result = await getGscKeywordIdeas({
        data: { projectId, dateRange: "last_28_days" },
      });
      return result.connected
        ? result.ideas.slice(0, 200).map((idea) => ({
            keyword: idea.keyword,
            position: idea.position,
            searchVolume: idea.impressions,
            traffic: idea.clicks,
          }))
        : [];
    },
    enabled: labsSupported,
  });

  const data = suggestionsQuery.data ?? [];

  // Pre-select top 20 by traffic once data loads.
  useEffect(() => {
    const items = suggestionsQuery.data;
    if (items && items.length > 0 && !hasInitialized) {
      const indexed = items.map((item, i) => ({
        index: i,
        traffic: item.traffic ?? 0,
      }));
      indexed.sort((a, b) => b.traffic - a.traffic);
      const initial: RowSelectionState = {};
      for (let i = 0; i < Math.min(PRE_SELECT_COUNT, indexed.length); i++) {
        initial[indexed[i].index] = true;
      }
      setRowSelection(initial);
      setHasInitialized(true);
    }
  }, [suggestionsQuery.data, hasInitialized]);

  const table = useDataTable({
    data,
    columns,
    state: { rowSelection, sorting },
    onRowSelectionChange: setRowSelection,
    onSortingChange: setSorting,
    withSorting: true,
    enableRowSelection: true,
  });

  const selectedCount = Object.keys(rowSelection).filter(
    (k) => rowSelection[k],
  ).length;

  const addMutation = useMutation({
    mutationFn: (keywords: string[]) =>
      addTrackingKeywords({ data: { projectId, configId, keywords } }),
    onSuccess: (result) => {
      toast.success(`Added ${result.added} keywords for tracking`);
      onDone(configId);
    },
  });

  const handleAdd = () => {
    const selectedKeywords = table
      .getSelectedRowModel()
      .rows.map((row) => row.original.keyword);
    if (selectedKeywords.length > 0) {
      addMutation.mutate(selectedKeywords);
    }
  };

  if (!labsSupported) {
    return (
      <>
        <StepHeader
          title="Add keywords manually"
          description="Ranked-keyword suggestions aren't available for this country. Continue and add the keywords you want to track manually."
        />
        <DialogFooter>
          <Button onClick={onClose}>Continue</Button>
        </DialogFooter>
      </>
    );
  }

  if (suggestionsQuery.isLoading) {
    return (
      <>
        <StepHeader title="Finding your top keywords..." />
        <div className="flex flex-col items-center justify-center py-16">
          <Spinner label="This usually takes a few seconds" />
        </div>
      </>
    );
  }

  if (suggestionsQuery.isError) {
    return (
      <>
        <StepHeader
          title="Couldn't fetch keywords"
          description="You can skip this step and add keywords manually later."
        />
        <DialogFooter>
          <Button onClick={onClose}>Skip</Button>
        </DialogFooter>
      </>
    );
  }

  if (data.length === 0) {
    return (
      <>
        <StepHeader
          title="No rankings found"
          description={
            gsc
              ? `Search Console has no queries for ${domain} in the last 28 days. You can add keywords manually.`
              : `We couldn't find any keywords ${domain} currently ranks for. You can add keywords manually.`
          }
        />
        <DialogFooter>
          <Button onClick={onClose}>Skip</Button>
        </DialogFooter>
      </>
    );
  }

  return (
    <>
      <StepHeader
        title="Choose keywords to track"
        description={
          gsc
            ? `${data.length} queries ${domain} got impressions for in Search Console, most impressions first. Their last ${GSC_BACKFILL_DAYS} days of positions fill in once saved.`
            : `We found ${data.length} keywords ${domain} ranks for.`
        }
      />

      <DataTable
        table={table}
        empty={{ title: "No keywords" }}
        scrollClassName="max-h-[400px]"
        onRowClick={(row, event) => {
          if (applyShiftRangeSelection(event, row, table, selectAnchorRef)) {
            return;
          }
          row.toggleSelected();
        }}
      />

      <DialogFooter className="items-center sm:justify-between">
        <p className="text-xs text-muted-foreground">
          {selectedCount} of {data.length} selected
        </p>
        <div className="flex items-center gap-2">
          <Button variant="ghost" onClick={onClose}>
            Skip
          </Button>
          <Button
            onClick={handleAdd}
            pending={addMutation.isPending}
            disabled={selectedCount === 0}
          >
            Save Keyword{selectedCount !== 1 ? "s" : ""}
          </Button>
        </div>
      </DialogFooter>
    </>
  );
}

function StepHeader({
  title,
  description,
}: {
  title: string;
  description?: string;
}) {
  return (
    <DialogHeader>
      <DialogTitle>{title}</DialogTitle>
      {description ? (
        <DialogDescription>{description}</DialogDescription>
      ) : null}
    </DialogHeader>
  );
}
