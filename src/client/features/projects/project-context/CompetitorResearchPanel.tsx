import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ConfirmDialog } from "@/client/components/ConfirmDialog";
import { QueryError, QueryState } from "@/client/components/QueryState";
import { Button } from "@/client/components/ui/button";
import { useSession } from "@/lib/auth-client";
import { startCompetitorResearch } from "@/serverFunctions/competitorResearch";
import { HELP_PATHS } from "@/shared/product-help";
import type {
  StartCompetitorResearchInput,
  StartCompetitorResearchResult,
} from "@/types/schemas/competitorResearch";
import { CompetitorResearchReview } from "./CompetitorResearchReview";
import {
  clearPendingCompetitorStart,
  competitorResearchQueryOptions,
  competitorResearchRunQueryOptions,
  newCompetitorStart,
  readPendingCompetitorStart,
  savePendingCompetitorStart,
} from "./competitorResearchQueries";
import { projectContextQueryKey } from "./shared";
import { DATAFORSEO_OPTIONAL_LABEL } from "@/client/features/dataforseo/dataforseoPages";

const reasons: Record<string, string> = {
  project_domain_missing: "Set this project's website first.",
  dataforseo_not_configured: DATAFORSEO_OPTIONAL_LABEL,
  model_not_configured: "AI isn't set up for this installation.",
  unsupported_background_authority:
    "Background research is not available for this sign-in mode.",
  insufficient_credits:
    "This workspace needs usage credits before research can start.",
};

export function CompetitorResearchPanel({ projectId }: { projectId: string }) {
  const { data: session } = useSession();
  const userId = session?.user.id ?? null;
  const queryClient = useQueryClient();
  const stateQuery = useQuery(competitorResearchQueryOptions(projectId));
  const [pending, setPending] = useState<StartCompetitorResearchInput | null>(
    null,
  );
  const [loadedScope, setLoadedScope] = useState<string | null>(null);
  const pendingScope = userId ? `${userId}:${projectId}` : null;
  const pendingReady = Boolean(userId) && loadedScope === pendingScope;
  const [selected, setSelected] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [lastStart, setLastStart] =
    useState<StartCompetitorResearchResult | null>(null);
  const runId =
    selected ??
    stateQuery.data?.activeRunId ??
    stateQuery.data?.recentRuns[0]?.id ??
    null;
  const runQuery = useQuery({
    ...competitorResearchRunQueryOptions(projectId, runId ?? projectId),
    enabled: Boolean(runId),
  });
  const availableRun =
    runQuery.data?.state === "available" ? runQuery.data.run : null;
  const runState = availableRun?.state;

  useEffect(() => {
    if (userId) setPending(readPendingCompetitorStart(projectId, userId));
    else setPending(null);
    setLoadedScope(pendingScope);
  }, [projectId, userId, pendingScope]);
  useEffect(() => {
    if (runState === "finished")
      void queryClient.invalidateQueries({
        queryKey: competitorResearchQueryOptions(projectId).queryKey,
      });
  }, [projectId, queryClient, runState]);

  const start = useMutation({
    mutationFn: (input: StartCompetitorResearchInput) =>
      startCompetitorResearch({ data: input }),
    onSuccess: async (result) => {
      setLastStart(result);
      if (result.ok) {
        setSelected(result.run.id);
        setPending(null);
        if (userId) clearPendingCompetitorStart(projectId, userId);
      } else {
        setPending(null);
        if (userId) clearPendingCompetitorStart(projectId, userId);
      }
      await queryClient.invalidateQueries({
        queryKey: competitorResearchQueryOptions(projectId).queryKey,
      });
    },
  });
  const submit = (input: StartCompetitorResearchInput) => {
    if (!userId || !pendingReady || start.isPending) return;
    setPending(input);
    savePendingCompetitorStart(projectId, userId, input);
    start.mutate(input);
  };

  return (
    <section
      aria-label="Discover competitors"
      className="space-y-3 rounded-lg border border-border bg-card p-4"
    >
      <div className="space-y-1">
        <h3 className="text-sm font-semibold">Discover competitors</h3>
        <p className="text-sm text-muted-foreground">
          Find additional businesses from live public search and page evidence.
          You review each suggestion before it joins your saved competitors.
        </p>
      </div>
      <QueryState
        query={stateQuery}
        errorFallback="Could not check competitor research readiness"
      >
        {(state) => (
          <>
            <p className="text-xs text-muted-foreground">
              One run uses up to {state.limits.maxQueries} Google searches at
              depth {state.limits.searchDepth}, {state.limits.maxPages} public
              pages and {state.limits.maxModelCalls} model call, within{" "}
              {Math.round(state.limits.maxRunDurationMs / 60_000)} minutes.
              Actual provider cost or quota use has no guaranteed dollar cap.
              Nothing is saved or tracked automatically.
            </p>
            {!state.ready ? (
              <div className="space-y-1 text-sm" role="status">
                {state.blockedReasons.map((reason) => (
                  <p key={reason}>{reasons[reason] ?? reason}</p>
                ))}
                <p>
                  <a className="underline" href={HELP_PATHS.dataforseo}>
                    DataForSEO setup guide
                  </a>{" "}
                  ·{" "}
                  <a className="underline" href={HELP_PATHS.openrouter}>
                    AI setup guide
                  </a>
                </p>
              </div>
            ) : null}
            <div className="flex flex-wrap gap-2">
              {pendingReady && pending ? (
                <Button
                  size="sm"
                  variant="outline"
                  pending={start.isPending}
                  disabled={!userId}
                  onClick={() => submit(pending)}
                >
                  Resume original request
                </Button>
              ) : null}
              {pendingReady && !pending && !state.activeRunId ? (
                <Button
                  size="sm"
                  disabled={!state.ready || !userId || start.isPending}
                  onClick={() => setConfirmOpen(true)}
                >
                  {state.recentRuns.length
                    ? "Research again"
                    : "Research competitors"}
                </Button>
              ) : null}
            </div>
            {lastStart && !lastStart.ok ? (
              <p role="alert" className="text-sm text-destructive">
                Research did not start: {lastStart.code}. Refresh the project
                status before a new request.
              </p>
            ) : null}
            {start.isError ? (
              <p role="alert" className="text-sm text-destructive">
                The start reply was not confirmed. Resume the original request
                to check its receipt; this does not create a new request ID.
              </p>
            ) : null}
            {state.activeRunId ? (
              <p className="text-sm text-muted-foreground">
                A research run is active. Its status is read below; no new work
                starts from this view.
              </p>
            ) : null}
            {state.recentRuns.length > 1 ? (
              <div
                className="flex flex-wrap gap-2"
                aria-label="Recent competitor runs"
              >
                {state.recentRuns.map((run) => (
                  <Button
                    key={run.id}
                    size="xs"
                    variant={runId === run.id ? "secondary" : "ghost"}
                    onClick={() => setSelected(run.id)}
                  >
                    {new Date(run.createdAtMs).toISOString().slice(0, 10)} ·{" "}
                    {run.outcome ?? run.state}
                  </Button>
                ))}
              </div>
            ) : null}
            {confirmOpen ? (
              <ConfirmDialog
                title="Start competitor research?"
                confirmLabel="Start bounded research"
                onClose={() => setConfirmOpen(false)}
                onConfirm={() => {
                  setConfirmOpen(false);
                  submit(newCompetitorStart(state));
                }}
              >
                This calls DataForSEO and your AI provider with the limits shown
                above and can incur real spend or quota use. Suggestions require
                your review; no competitor is added automatically.
              </ConfirmDialog>
            ) : null}
          </>
        )}
      </QueryState>
      {runId && runQuery.isError ? (
        <QueryError
          error={runQuery.error}
          fallback="Could not load competitor run"
          onRetry={() => void runQuery.refetch()}
        />
      ) : null}
      {runQuery.data?.state === "unavailable" ? (
        <p role="status" className="text-sm">
          This run was privacy erased and is unavailable.
        </p>
      ) : null}
      {availableRun ? (
        <CompetitorResearchReview
          key={`${availableRun.id}:${userId ?? ""}`}
          projectId={projectId}
          userId={userId}
          run={availableRun}
          contextVersion={
            stateQuery.data?.contextVersion ??
            availableRun.snapshot.contextVersion
          }
          onRefresh={() => {
            void queryClient.invalidateQueries({
              queryKey: projectContextQueryKey(projectId),
            });
            void queryClient.invalidateQueries({
              queryKey: competitorResearchQueryOptions(projectId).queryKey,
            });
            void queryClient.invalidateQueries({
              queryKey: competitorResearchRunQueryOptions(
                projectId,
                availableRun.id,
              ).queryKey,
            });
          }}
        />
      ) : null}
    </section>
  );
}
