import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { Alert, AlertDescription } from "@/client/components/ui/alert";
import { Button } from "@/client/components/ui/button";
import { InsufficientCreditsError } from "@/client/features/billing/InsufficientCreditsError";
import {
  clearPendingResearchRequest,
  readPendingResearchRequest,
  researchRequestIdFor,
} from "@/client/features/projects/websiteResearchRequest";
import { getErrorCode } from "@/client/lib/error-messages";
import {
  generateContentDraft,
  getContentDraftRequest,
  getContentDraftSetup,
} from "@/serverFunctions/contentDraft";
import type { SavedContentRevision } from "@/types/schemas/content";
import type { ContentDraftRequest } from "@/types/schemas/contentDraft";
import type { SavedContentSource } from "@/types/schemas/contentEvidence";

type DraftResult = Awaited<ReturnType<typeof generateContentDraft>>;

const versionsSchema = z.tuple([
  z.number().int().nonnegative(),
  z.number().int().nonnegative(),
]);

function readPending(projectId: string, contentId: string) {
  const pending = readPendingResearchRequest(
    "content-draft",
    `${projectId}:${contentId}`,
  );
  if (!pending) return null;
  try {
    const versions = versionsSchema.safeParse(JSON.parse(pending.website));
    if (!versions.success) return null;
    return {
      projectId,
      contentId,
      requestId: pending.requestId,
      expectedHeadVersion: versions.data[0],
      expectedContextVersion: versions.data[1],
    };
  } catch {
    return null;
  }
}

function messageFor(result: DraftResult) {
  switch (result.status) {
    case "none":
      return "That request never reached the server. Nothing was generated.";
    case "unknown":
      return result.reason === "cost_not_reported"
        ? "We couldn’t confirm what this draft cost, so it wasn’t saved. Starting again may cost more."
        : "We can’t confirm whether this draft finished. Starting again may cost more.";
    case "needs_setup":
      return "Draft generation needs setup. An administrator adds a model key or chooses an AI engine in Settings.";
    case "busy":
      return "Another draft is running or this content just changed. Reload and try again.";
    case "blocked":
      return result.reason === "no_sources"
        ? "Attach a saved source with usable text first."
        : result.reason === "archived"
          ? "This content is archived."
          : "This content changed before the draft started. Nothing was generated.";
    case "failed":
      return result.reason === "no_supported_content"
        ? "Nothing in the reply could be tied to a source, so no revision was saved. This may have cost credits. Add better sources and try again."
        : result.reason === "model_failed"
          ? "The draft couldn’t be generated and no revision was saved. This may have cost credits."
          : "This content changed while the draft ran, so it wasn’t saved. This may have cost credits.";
    default:
      return null;
  }
}

export function ContentDraftGenerator({
  revision,
  sources,
  draft,
  currentContextVersion,
  archived,
  dirty,
  onBusyChange,
  onGenerated,
}: {
  revision: SavedContentRevision;
  sources: SavedContentSource[];
  draft: { expectedHeadVersion: number; expectedContextVersion: number };
  currentContextVersion: number;
  archived: boolean;
  dirty: boolean;
  onBusyChange: (busy: boolean) => void;
  onGenerated: (revision: SavedContentRevision) => void;
}) {
  const { projectId, contentId } = revision;
  const { expectedContextVersion } = draft;
  const client = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const [outcome, setOutcome] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // A reply lost to a reload or dropped connection is read back by its request
  // ID, because generating again would charge again.
  const [pending, setPending] = useState<ContentDraftRequest | null>(null);
  useEffect(() => {
    setPending(readPending(projectId, contentId));
  }, [projectId, contentId]);
  const setup = useQuery({
    queryKey: ["content-draft-setup", projectId],
    queryFn: () => getContentDraftSetup({ data: { projectId } }),
  });
  const forget = () => {
    clearPendingResearchRequest("content-draft", `${projectId}:${contentId}`);
    setPending(null);
  };
  const apply = (result: DraftResult) => {
    if (result.status === "running") return;
    forget();
    setOutcome(messageFor(result));
    if (result.status !== "done") return;
    const left = result.revision.omissions.length;
    const questions = result.revision.openQuestions.length;
    setNotice(
      `Draft saved as revision ${result.revision.version}. ${left} left out and ${questions} open ${questions === 1 ? "question" : "questions"}. See Metadata, questions and omissions.`,
    );
    onGenerated(result.revision);
    void client.invalidateQueries({
      queryKey: ["content", projectId, contentId],
    });
    void client.invalidateQueries({ queryKey: ["content-list", projectId] });
  };
  const generate = useMutation({
    mutationFn: (request: ContentDraftRequest) =>
      generateContentDraft({ data: { ...request, confirmedPaidWork: true } }),
    onSuccess: (result, request) => {
      if (result.status === "running") setPending(request);
      apply(result);
    },
    onError: (error, request) => {
      // A coded refusal never started. Anything else may have, so keep the ID.
      if (getErrorCode(error)) forget();
      else setPending(request);
    },
  });
  const read = useQuery({
    queryKey: ["content-draft-request", pending?.requestId],
    queryFn: () => {
      if (!pending) throw new Error("No draft request");
      return getContentDraftRequest({ data: pending });
    },
    enabled: Boolean(pending) && !generate.isPending,
    retry: false,
    staleTime: 0,
    gcTime: 0,
    refetchInterval: (query) =>
      query.state.data?.status === "running" ? 3000 : false,
  });
  const readData = read.data;
  useEffect(() => {
    if (readData) apply(readData);
    // apply only reads props that key this editor.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [readData]);
  const busy = generate.isPending || Boolean(pending);
  useEffect(() => onBusyChange(busy), [busy, onBusyChange]);

  const attached = sources.filter(
    (source) =>
      revision.sourceIds.includes(source.id) &&
      source.sourceText.trim() &&
      ["usable", "partial"].includes(source.extractionStatus),
  );
  const blocked = archived
    ? "This content is archived."
    : dirty
      ? "Save your changes before generating a draft."
      : revision.version !== draft.expectedHeadVersion
        ? "Load the latest revision before generating a draft."
        : currentContextVersion !== expectedContextVersion
          ? "Project context changed. Use the current context and save first."
          : attached.length
            ? null
            : "Attach a saved source with usable text first.";
  const start = () => {
    const versions = JSON.stringify([revision.version, expectedContextVersion]);
    const request = {
      projectId,
      contentId,
      expectedHeadVersion: revision.version,
      expectedContextVersion,
      requestId: researchRequestIdFor(
        "content-draft",
        `${projectId}:${contentId}`,
        versions,
      ),
    };
    setConfirming(false);
    setOutcome(null);
    setNotice(null);
    generate.mutate(request);
  };

  return (
    <div className="space-y-3 rounded-md border p-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="font-medium">Draft from your sources</p>
        {setup.data?.configured === false ? (
          <p className="text-muted-foreground">Needs setup</p>
        ) : (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={busy || confirming || !setup.data || blocked !== null}
            onClick={() => {
              setOutcome(null);
              setNotice(null);
              setConfirming(true);
            }}
          >
            {busy ? "Generating…" : "Generate draft"}
          </Button>
        )}
      </div>
      {setup.data?.configured === false ? (
        <p className="text-muted-foreground">
          {setup.data.notConfiguredMessage ??
            "Draft generation needs setup. An administrator adds a model key or chooses an AI engine in Settings."}
        </p>
      ) : blocked && !busy ? (
        <p className="text-muted-foreground">{blocked}</p>
      ) : null}
      {busy ? (
        <p className="text-muted-foreground">
          This can take up to two minutes. If you leave, come back to this page
          to see the result.
        </p>
      ) : null}
      {confirming && setup.data ? (
        <div className="space-y-2 rounded-md border p-3">
          <p>
            Uses only this brief, your project context and these sources. A fact
            with no matching source, or whose source says the opposite, is left
            out and listed for you. These checks only compare words, and only in
            English, so a statement can still misread its source. Check each
            claim against its source in review.
          </p>
          <ul className="text-muted-foreground list-disc pl-5">
            {attached.map((source) => (
              <li key={source.id} className="break-words">
                {source.title} · {source.attribution} ·{" "}
                {new Date(source.capturedAtMs).toLocaleDateString()}
                {source.extractionStatus === "partial" ? " · partial text" : ""}
              </li>
            ))}
          </ul>
          {setup.data.includedInSubscription ? (
            <p>
              Cost: one request, included in your subscription. Your
              provider&apos;s plan limits apply.
            </p>
          ) : (
            <p>
              Cost: one request, up to{" "}
              {setup.data.maxOutputTokens.toLocaleString()} output tokens,{" "}
              {setup.data.usesCredits
                ? "paid from your usage credits"
                : "charged to your configured model key"}
              . The exact cost is only known afterwards and is recorded on the
              revision.
            </p>
          )}
          <p>
            The result is a new revision that replaces the text in this editor.
            Earlier revisions stay in history. It is never published or approved
            automatically.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" onClick={start}>
              Confirm and generate
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => setConfirming(false)}
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : null}
      {notice ? <p role="status">{notice}</p> : null}
      {getErrorCode(generate.error) === "INSUFFICIENT_CREDITS" ? (
        <InsufficientCreditsError title="We couldn’t generate this draft" />
      ) : outcome ? (
        <Alert variant="destructive">
          <AlertDescription>{outcome}</AlertDescription>
        </Alert>
      ) : generate.isError && !pending ? (
        <Alert variant="destructive">
          <AlertDescription>
            We couldn’t start this draft. Try again.
          </AlertDescription>
        </Alert>
      ) : null}
    </div>
  );
}
