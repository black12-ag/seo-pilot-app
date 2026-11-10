import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Play } from "lucide-react";
import { BackLink, PageHeader } from "@/client/components/PageHeader";
import { SkeletonCard } from "@/client/components/SkeletonPresets";
import { Button } from "@/client/components/ui/button";
import { type AiRun } from "@/shared/ai-visibility";
import { AskSamButton } from "@/client/features/sam/AskSamButton";
import { PromptAnalysis } from "./PromptAnalysis";
import { prefetchRunNowCost, TrackingCostReview } from "./TrackingCostReview";
import {
  AiQueryError,
  AiRunStatus,
  aiPromptHistoryQueryOptions,
  aiVisibilityKey,
  useAiRunProgress,
  useAiVisibilityTracker,
} from "./shared";

export function PromptHistoryPage({
  projectId,
  promptId,
}: {
  projectId: string;
  promptId: string;
}) {
  const queryClient = useQueryClient();
  const trackerQuery = useAiVisibilityTracker(projectId);
  const [checking, setChecking] = useState(false);
  const [startedRun, setStartedRun] = useState<AiRun | null>(null);
  const progress = useAiRunProgress(projectId, startedRun);
  const history = useQuery(aiPromptHistoryQueryOptions(projectId, promptId));
  const state = trackerQuery.data;
  const prompt = state?.prompts.find((item) => item.id === promptId);
  const latestRun = history.data?.historyRuns.find((run) =>
    history.data?.rows.some((row) => row.runId === run.id),
  );
  const retainedPrompt = history.data?.rows.find(
    (row) => row.runId === latestRun?.id,
  )?.prompt;
  const busy =
    progress.run?.status === "queued" || progress.run?.status === "running";
  const tracker = state?.tracker;
  // Price this prompt's Run now on load, so the dialog opens on a price.
  useEffect(() => {
    if (tracker)
      prefetchRunNowCost(queryClient, projectId, tracker, [promptId]);
  }, [queryClient, projectId, promptId, tracker]);
  return (
    <div className="space-y-4">
      <PageHeader
        backLink={
          <BackLink to="/p/$projectId/ai-visibility" params={{ projectId }}>
            All tracked prompts
          </BackLink>
        }
        title={
          <span className="whitespace-pre-wrap" data-ph-mask>
            {prompt?.text ?? retainedPrompt ?? "Prompt analysis"}
          </span>
        }
        description={
          prompt ? `${prompt.topic} · Prompt analysis` : "Prompt analysis"
        }
        actions={
          <>
            {(prompt?.text ?? retainedPrompt) && (
              <AskSamButton
                projectId={projectId}
                label="Ask SAM why we're not mentioned"
                size="default"
                question={`Why isn't our brand mentioned in AI answers to the tracked prompt "${prompt?.text ?? retainedPrompt}"? Check the latest answers and the pages they cite, tell me who gets mentioned instead, and what we should change.`}
              />
            )}
            {state?.tracker && prompt && !prompt.archived && !prompt.paused && (
              <Button
                disabled={!state.providerConfigured || busy}
                onClick={() => setChecking(true)}
              >
                <Play />
                Run now
              </Button>
            )}
          </>
        }
      />
      {trackerQuery.error && (
        <AiQueryError
          error={trackerQuery.error}
          retry={() => {
            void trackerQuery.refetch();
          }}
        />
      )}
      {progress.run && <AiRunStatus run={progress.run} />}
      {progress.error && <AiQueryError error={progress.error} />}
      {history.isPending ? (
        <SkeletonCard />
      ) : history.isError ? (
        <AiQueryError
          error={history.error}
          retry={() => {
            void history.refetch();
          }}
        />
      ) : (
        <PromptAnalysis
          key={`${promptId}:${startedRun?.id ?? ""}`}
          projectId={projectId}
          prompt={prompt}
          history={history.data}
        />
      )}
      {checking && state?.tracker && (
        <TrackingCostReview
          projectId={projectId}
          tracker={state.tracker}
          mode="check"
          promptIds={[promptId]}
          onClose={() => setChecking(false)}
          onStarted={(run) => {
            setChecking(false);
            setStartedRun(run);
            void queryClient.invalidateQueries({
              queryKey: aiVisibilityKey(projectId),
            });
          }}
        />
      )}
    </div>
  );
}
