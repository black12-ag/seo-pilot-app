import { queryOptions, useQuery } from "@tanstack/react-query";
import { PageHeader } from "@/client/components/PageHeader";
import { QueryError } from "@/client/components/QueryState";
import { getPublishingStatus } from "@/serverFunctions/publishing";
import { PublishRecordsTable } from "./PublishRecordsTable";
import { SendDraftCard } from "./SendDraftCard";
import { WordPressConnectionCard } from "./WordPressConnectionCard";

const publishingStatusQuery = (projectId: string) =>
  queryOptions({
    queryKey: ["publishing-status", projectId],
    queryFn: () => getPublishingStatus({ data: { projectId } }),
    staleTime: 0,
  });

export function PublishingPage({ projectId }: { projectId: string }) {
  const query = useQuery(publishingStatusQuery(projectId));
  const refresh = () => query.refetch();
  const status = query.data;
  return (
    <div className="mx-auto w-full max-w-5xl space-y-6 p-4 md:p-6">
      <PageHeader
        title="A careful path to live"
        description="Send approved content to WordPress as a draft, and see what the site really holds."
      />
      {query.isError ? (
        <QueryError
          error={query.error}
          fallback="Couldn't load publishing."
          onRetry={() => void query.refetch()}
          isRetrying={query.isFetching}
        />
      ) : !status ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (
        <>
          <WordPressConnectionCard
            key={status.authority.origin ?? "none"}
            projectId={projectId}
            status={status}
            onChanged={refresh}
          />
          {status.canManage &&
          status.connection?.read.status === "granted" &&
          status.connection.write.status === "granted" ? (
            <SendDraftCard projectId={projectId} onChanged={refresh} />
          ) : null}
          <PublishRecordsTable
            projectId={projectId}
            records={status.records}
            canManage={status.canManage}
            onChanged={refresh}
          />
        </>
      )}
    </div>
  );
}
