import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { Loader2, Save } from "lucide-react";
import { toast } from "sonner";
import { QueryError } from "@/client/components/QueryState";
import {
  DataTable,
  useDataTable,
  useSelectionAnchor,
} from "@/client/components/table/DataTable";
import { DataTableTabs } from "@/client/components/table/DataTableToolbar";
import {
  TableBulkActionBar,
  TableBulkActionButton,
} from "@/client/components/table/TableBulkActionBar";
import { TablePagination } from "@/client/components/table/TablePagination";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/client/components/ui/select";
import { Spinner } from "@/client/components/ui/spinner";
import { TabsTrigger } from "@/client/components/ui/tabs";
import { GoogleConnectionCard } from "@/client/features/integrations/GoogleConnectionCard";
import { dataforseoHelpLinkOptions } from "@/client/navigation/items";
import { captureClientEvent } from "@/client/lib/posthog";
import { getGscKeywordIdeas } from "@/serverFunctions/gscKeywordIdeas";
import { saveKeywords } from "@/serverFunctions/keywords";
import {
  SEARCH_PERFORMANCE_RANGES,
  type SearchPerformanceDateRange,
} from "@/types/schemas/search-performance";
import { buildGscKeywordIdeaColumns } from "./gscKeywordIdeaColumns";

const RANGE_ITEMS: { value: SearchPerformanceDateRange; label: string }[] = [
  { value: "last_7_days", label: "Last 7 days" },
  { value: "last_28_days", label: "Last 28 days" },
  { value: "last_3_months", label: "Last 3 months" },
];
const DEVICE_ITEMS = [
  { value: "ALL", label: "All devices" },
  { value: "DESKTOP", label: "Desktop" },
  { value: "MOBILE", label: "Mobile" },
  { value: "TABLET", label: "Tablet" },
] as const;
type DeviceValue = (typeof DEVICE_ITEMS)[number]["value"];
const PAGE_SIZES = [25, 50, 100] as const;

function isDevice(value: string): value is DeviceValue {
  return DEVICE_ITEMS.some((item) => item.value === value);
}

function isRange(value: string): value is SearchPerformanceDateRange {
  return SEARCH_PERFORMANCE_RANGES.some((range) => range === value);
}

/**
 * Keyword Research with no DataForSEO key: the site's own Search Console
 * queries. Impressions are labelled as impressions, never as search volume.
 */
export function GscKeywordIdeasPage({ projectId }: { projectId: string }) {
  const queryClient = useQueryClient();
  const anchorRef = useSelectionAnchor();
  const [range, setRange] =
    useState<SearchPerformanceDateRange>("last_28_days");
  const [device, setDevice] = useState<DeviceValue>("ALL");
  const [tab, setTab] = useState<"all" | "striking">("all");
  const [rowSelection, setRowSelection] = useState({});
  const [pagination, setPagination] = useState({ pageIndex: 0, pageSize: 50 });

  const ideasQuery = useQuery({
    queryKey: ["gscKeywordIdeas", projectId, range, device],
    queryFn: () =>
      getGscKeywordIdeas({
        data: {
          projectId,
          dateRange: range,
          ...(device !== "ALL" && { device }),
        },
      }),
    placeholderData: keepPreviousData,
  });
  const result = ideasQuery.data;
  const rows = useMemo(() => {
    if (!result?.connected) return [];
    return tab === "striking"
      ? result.ideas.filter((idea) => idea.strikingDistance)
      : result.ideas;
  }, [result, tab]);

  const columns = useMemo(
    () => buildGscKeywordIdeaColumns(anchorRef, projectId),
    [anchorRef, projectId],
  );
  const table = useDataTable({
    data: rows,
    columns,
    withSorting: true,
    withPagination: true,
    enableRowSelection: true,
    state: { rowSelection, pagination },
    onRowSelectionChange: setRowSelection,
    onPaginationChange: setPagination,
    getRowId: (row) => row.keyword,
    initialState: { sorting: [{ id: "impressions", desc: true }] },
  });
  const selected = table
    .getSelectedRowModel()
    .rows.map((row) => row.original.keyword);

  const save = useMutation({
    mutationFn: (keywords: string[]) =>
      saveKeywords({ data: { projectId, keywords } }),
    onSuccess: (_result, keywords) => {
      captureClientEvent("keyword:save", {
        source_feature: "gsc_keyword_ideas",
        keyword_count: keywords.length,
      });
      void queryClient.invalidateQueries({
        queryKey: ["savedKeywords", projectId],
      });
      toast.success(
        `Saved ${keywords.length} ${keywords.length === 1 ? "keyword" : "keywords"}. They also appear in Keyword Clusters.`,
      );
      setRowSelection({});
    },
  });

  return (
    <div className="mx-auto max-w-6xl px-4 py-4 md:px-6 md:py-6">
      <h1 className="text-2xl font-semibold">Keyword Research</h1>
      <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
        Free, from your Search Console: the queries your site already shows up
        for on Google. Impressions are how often your site was shown, not search
        volume, and only queries your site appeared for are listed. Data is
        about 2-3 days behind.{" "}
        <Link
          {...dataforseoHelpLinkOptions}
          className="text-primary hover:underline"
        >
          Add a DataForSEO key
        </Link>{" "}
        for search volume and new keyword ideas.
      </p>

      <div className="mt-4 rounded-lg border">
        {ideasQuery.isPending ? (
          <div className="flex min-h-40 items-center justify-center">
            <Spinner />
          </div>
        ) : ideasQuery.isError ? (
          <div className="p-4">
            <QueryError
              error={ideasQuery.error}
              fallback="Couldn't load your Search Console queries."
              onRetry={() => void ideasQuery.refetch()}
              isRetrying={ideasQuery.isFetching}
            />
          </div>
        ) : !result?.connected ? (
          <div className="p-4">
            <GoogleConnectionCard provider="gsc" projectId={projectId} />
          </div>
        ) : (
          <>
            <DataTableTabs
              value={tab}
              onValueChange={(value) => {
                setTab(value === "striking" ? "striking" : "all");
                setPagination((page) => ({ ...page, pageIndex: 0 }));
              }}
              description={
                tab === "striking"
                  ? "Queries at average position 5 to 20: improving the listed page most often moves these onto page one."
                  : "Sorted by impressions. Select queries to save them to Saved Keywords and Keyword Clusters."
              }
              actions={
                <div className="flex flex-wrap items-center gap-2">
                  <Select
                    items={DEVICE_ITEMS}
                    value={device}
                    onValueChange={(value) =>
                      value && isDevice(value) && setDevice(value)
                    }
                  >
                    <SelectTrigger
                      size="sm"
                      className="w-36"
                      aria-label="Device"
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {DEVICE_ITEMS.map((item) => (
                        <SelectItem key={item.value} value={item.value}>
                          {item.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Select
                    items={RANGE_ITEMS}
                    value={range}
                    onValueChange={(value) =>
                      value && isRange(value) && setRange(value)
                    }
                  >
                    <SelectTrigger
                      size="sm"
                      className="w-36"
                      aria-label="Date range"
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {RANGE_ITEMS.map((item) => (
                        <SelectItem key={item.value} value={item.value}>
                          {item.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              }
            >
              <TabsTrigger value="all">All queries</TabsTrigger>
              <TabsTrigger value="striking">Striking distance</TabsTrigger>
            </DataTableTabs>
            <div className="p-4">
              <DataTable
                table={table}
                empty={{
                  title: "No queries yet",
                  description:
                    "Search Console has no queries for this site in this period.",
                }}
              />
            </div>
            {rows.length > 0 && (
              <TablePagination
                page={pagination.pageIndex + 1}
                pageSize={pagination.pageSize}
                pageSizes={PAGE_SIZES}
                totalCount={rows.length}
                onPageChange={(page) =>
                  setPagination((current) => ({
                    ...current,
                    pageIndex: page - 1,
                  }))
                }
                onPageSizeChange={(pageSize) =>
                  setPagination({ pageIndex: 0, pageSize })
                }
              />
            )}
          </>
        )}
      </div>

      <TableBulkActionBar
        selectedCount={selected.length}
        selectedLabel={selected.length === 1 ? "query" : "queries"}
        onClear={() => setRowSelection({})}
        actions={
          <div className="flex items-center gap-1 px-1.5">
            <TableBulkActionButton
              icon={
                save.isPending ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Save className="size-3.5" />
                )
              }
              onClick={() => save.mutate(selected)}
              disabled={save.isPending}
            >
              Save as keywords
            </TableBulkActionButton>
          </div>
        }
      />
    </div>
  );
}
