import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent } from "@/client/components/ui/card";
import { WebsiteResearchProgress } from "./WebsiteResearchProgress";
import { Button } from "@/client/components/ui/button";
import { Input } from "@/client/components/ui/input";
import { Field, FieldLabel } from "@/client/components/ui/field";
import { Alert, AlertDescription } from "@/client/components/ui/alert";
import { InsufficientCreditsError } from "@/client/features/billing/InsufficientCreditsError";
import { getErrorCode } from "@/client/lib/error-messages";
import {
  isEveryAppClientAuthMode,
  isHostedClientAuthMode,
} from "@/lib/auth-mode";
import { projectsQueryOptions } from "@/client/features/projects/projectQueries";
import { projectContextQueryKey } from "@/client/features/projects/project-context/shared";
import { getProjectContext } from "@/serverFunctions/projectContext";
import { WebsiteSetupReview } from "@/client/features/projects/WebsiteSetupReview";
import {
  clearPendingResearchRequest,
  clearRefusedResearchRequest,
  readPendingResearchRequest,
  researchErrorMessage,
  researchRequestIdFor,
} from "@/client/features/projects/websiteResearchRequest";
import {
  getProjectWebsiteResearch,
  researchProjectWebsite,
  saveProjectWebsiteSetup,
} from "@/serverFunctions/projectWebsite";
import type {
  WebsiteResearch,
  SaveProjectWebsiteSetup,
} from "@/types/schemas/projectWebsite";

type ResearchResult = Awaited<ReturnType<typeof researchProjectWebsite>>;
type ResearchOutcome = "failed" | "unknown" | "blocked" | "running_elsewhere";

const OUTCOME_MESSAGES: Record<ResearchOutcome, string> = {
  failed:
    "We couldn’t research this website. Check the URL and provider settings, then try again.",
  unknown:
    "We can’t confirm whether this research finished. Starting again may use more credits.",
  blocked:
    "This research is no longer available. Start a new one if you need it.",
  running_elsewhere:
    "An earlier setup for this project is still running. Try again when it finishes.",
};

function outcomeFor(status: ResearchResult["status"]): ResearchOutcome {
  if (status === "unknown") return "unknown";
  if (status === "legacy_running") return "running_elsewhere";
  if (status === "failed") return "failed";
  return "blocked";
}

export function ProjectWebsiteSetup({ projectId }: { projectId: string }) {
  const queryClient = useQueryClient();
  const [website, setWebsite] = useState("");
  const [research, setResearch] = useState<WebsiteResearch | null>(null);
  // Saved context decides which research steps run.
  const context = useQuery({
    queryKey: projectContextQueryKey(projectId),
    queryFn: () => getProjectContext({ data: { projectId } }),
  });
  // A reply lost to a reload or dropped connection is read back by its request
  // ID, because running the research again would charge again.
  const [pendingAttemptId, setPendingAttemptId] = useState<string | null>(null);
  useEffect(() => {
    const pending = readPendingResearchRequest("direct", projectId);
    if (pending) {
      setWebsite(pending.website);
      setPendingAttemptId(pending.requestId);
    }
  }, [projectId]);
  const [outcome, setOutcome] = useState<ResearchOutcome | null>(null);
  const endResearch = () => {
    clearPendingResearchRequest("direct", projectId);
    setPendingAttemptId(null);
  };
  const applyResult = (result: ResearchResult) => {
    if (result.review) setResearch(result.review);
    if (result.status === "admitted" || result.status === "running") {
      setPendingAttemptId(result.attemptId);
      return;
    }
    // A review keeps its ID until Save or Back, so a reload reads this finished
    // run back instead of losing it and paying for another.
    if (result.review) return;
    endResearch();
    setOutcome(outcomeFor(result.status));
  };
  const researchMutation = useMutation({
    mutationFn: () =>
      researchProjectWebsite({
        data: {
          projectId,
          website,
          requestId: researchRequestIdFor("direct", projectId, website),
          confirmedPaidWork: true,
        },
      }),
    onMutate: () => setOutcome(null),
    onSuccess: applyResult,
    onError: (error) => clearRefusedResearchRequest("direct", projectId, error),
  });
  const attempt = useQuery({
    queryKey: ["websiteResearchAttempt", projectId, pendingAttemptId],
    queryFn: () =>
      getProjectWebsiteResearch({
        data: { projectId, attemptId: pendingAttemptId! },
      }),
    enabled: Boolean(pendingAttemptId) && !researchMutation.isPending,
    retry: false,
    refetchInterval: (query) =>
      query.state.data?.status === "admitted" ||
      query.state.data?.status === "running"
        ? 3000
        : false,
  });
  const attemptData = attempt.data;
  useEffect(() => {
    if (attemptData) applyResult(attemptData);
    // applyResult only reads projectId, which keys this form.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attemptData]);
  const saveMutation = useMutation({
    mutationFn: (accepted: Omit<SaveProjectWebsiteSetup, "projectId">) =>
      saveProjectWebsiteSetup({ data: { ...accepted, projectId } }),
    onSuccess: async () => {
      endResearch();
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: projectsQueryOptions().queryKey,
        }),
        queryClient.invalidateQueries({
          queryKey: ["projectAccess", projectId],
        }),
        queryClient.invalidateQueries({
          queryKey: ["projectContext", projectId],
        }),
        queryClient.invalidateQueries({
          queryKey: ["aiVisibility", projectId],
        }),
      ]);
      toast.success("Project context saved");
    },
  });
  if (research)
    return (
      <WebsiteSetupReview
        projectId={projectId}
        research={research}
        saving={saveMutation.isPending}
        error={saveMutation.isError}
        onSave={(accepted) => saveMutation.mutate(accepted)}
        onBack={() => {
          endResearch();
          setResearch(null);
          saveMutation.reset();
          researchMutation.reset();
        }}
      />
    );
  if (
    researchMutation.isPending ||
    (pendingAttemptId && !attempt.isError && outcome === null)
  )
    return (
      <WebsiteResearchProgress
        missingOverview={
          !context.data?.sections.some(
            (section) => section.key === "business_overview",
          )
        }
        missingCompetitors={!context.data?.competitors.length}
      />
    );
  return (
    <Card className="w-full max-w-2xl py-6 md:py-8">
      <CardContent className="px-6 md:px-8">
        <form
          className="space-y-6"
          onSubmit={(event) => {
            event.preventDefault();
            researchMutation.mutate();
          }}
        >
          <div>
            <div className="mb-4 flex size-10 items-center justify-center rounded-lg border border-border bg-muted">
              <Sparkles className="size-5" />
            </div>
            <h1 className="text-2xl font-semibold tracking-tight">
              Set up AI visibility
            </h1>
            <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
              We’ll research your brand and find the most relevant topics to
              monitor.
            </p>
          </div>
          <Field>
            <FieldLabel htmlFor="project-website">Website URL</FieldLabel>
            <Input
              id="project-website"
              inputMode="url"
              autoComplete="url"
              placeholder="Enter your website URL"
              value={website}
              onChange={(event) => setWebsite(event.target.value)}
              required
            />
          </Field>
          {getErrorCode(researchMutation.error) === "INSUFFICIENT_CREDITS" ? (
            <InsufficientCreditsError title="We couldn’t research this website" />
          ) : outcome ? (
            <Alert variant="destructive">
              <AlertDescription>{OUTCOME_MESSAGES[outcome]}</AlertDescription>
            </Alert>
          ) : (
            researchMutation.isError && (
              <Alert variant="destructive">
                <AlertDescription>
                  {researchErrorMessage(researchMutation.error)}
                </AlertDescription>
              </Alert>
            )
          )}
          <div className="space-y-3">
            <Button
              type="submit"
              size="lg"
              disabled={!website.trim()}
              className="w-full"
            >
              Start research
            </Button>
            <p className="text-xs leading-relaxed text-muted-foreground">
              {isEveryAppClientAuthMode()
                ? "Research and a first run of your prompts use the DataForSEO and OpenRouter keys on your Every App gateway."
                : isHostedClientAuthMode()
                  ? "Research and a first run of your prompts use a small amount of usage credits."
                  : "Research and a first run of your prompts use your AI setup and your DataForSEO account."}
            </p>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
