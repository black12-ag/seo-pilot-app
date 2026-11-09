import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { captureClientEvent } from "@/client/lib/posthog";
import { triggerRankCheck } from "@/serverFunctions/rank-tracking";

export function useRankCheckTrigger({
  configId,
  isRunning,
  projectId,
  gsc = false,
  onSuccess,
}: {
  configId: string;
  isRunning: boolean;
  projectId: string;
  /** Search Console trackers finish inline, so their data is ready now. */
  gsc?: boolean;
  onSuccess: () => void;
}) {
  const queryClient = useQueryClient();

  const triggerMutation = useMutation({
    mutationFn: (opts: { keywordIds?: string[] }) =>
      triggerRankCheck({
        data: {
          projectId,
          configId,
          keywordIds: opts.keywordIds,
        },
      }),
    onSuccess: (result) => {
      onSuccess();
      void queryClient.invalidateQueries({
        queryKey: ["rankTrackingLatestRun", projectId, configId],
      });
      if (!result.ok) {
        toast.info("A rank check is already running");
        return;
      }

      captureClientEvent("rank_tracking:check_trigger");
      if (gsc) {
        for (const key of ["rankTrackingResults", "rankPositionMatrix"]) {
          void queryClient.invalidateQueries({
            queryKey: [key, projectId, configId],
          });
        }
        toast.success("Search Console data is up to date");
        return;
      }
      toast.success("Rank check started");
    },
  });

  const startCheck = (opts: { keywordIds?: string[] }) => {
    if (triggerMutation.isPending || isRunning) return;
    triggerMutation.mutate(opts);
  };

  return {
    startCheck,
    /** True while the trigger request is in-flight */
    isPending: triggerMutation.isPending,
    /** True when any check activity is happening (running, starting, or pending) */
    isBusy: isRunning || triggerMutation.isPending,
  };
}
