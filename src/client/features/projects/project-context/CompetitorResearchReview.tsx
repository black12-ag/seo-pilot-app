import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation } from "@tanstack/react-query";
import { Button } from "@/client/components/ui/button";
import { ConfirmDialog } from "@/client/components/ConfirmDialog";
import { Input } from "@/client/components/ui/input";
import { acceptCompetitorResearch } from "@/serverFunctions/competitorResearch";
import type {
  AcceptCompetitorResearchInput,
  AcceptCompetitorResearchResult,
  CompetitorResearchRun,
} from "@/types/schemas/competitorResearch";
import {
  clearPendingCompetitorAccept,
  readPendingCompetitorAccept,
  savePendingCompetitorAccept,
} from "./competitorResearchQueries";

type Draft = Record<string, { selected: boolean; name: string; notes: string }>;

function showStaleWarning(
  run: CompetitorResearchRun,
  receipt: AcceptCompetitorResearchResult | null,
  pendingInput: AcceptCompetitorResearchInput | null,
  stale: boolean,
) {
  return stale && run.reviewState === "open" && !receipt?.ok && !pendingInput;
}

export function CompetitorResearchReview({
  projectId,
  userId,
  run,
  contextVersion,
  onRefresh,
}: {
  projectId: string;
  userId: string | null;
  run: CompetitorResearchRun;
  contextVersion: number;
  onRefresh: () => void;
}) {
  const [draft, setDraft] = useState<Draft>(() =>
    Object.fromEntries(
      run.candidates.map((candidate) => [
        candidate.id,
        { selected: false, name: candidate.name, notes: candidate.notes },
      ]),
    ),
  );
  const [pendingInput, setPendingInput] =
    useState<AcceptCompetitorResearchInput | null>(null);
  const [receiptLoaded, setReceiptLoaded] = useState(false);
  const [storedForReload, setStoredForReload] = useState(false);
  const [confirmEmpty, setConfirmEmpty] = useState(false);
  const [receipt, setReceipt] = useState<AcceptCompetitorResearchResult | null>(
    null,
  );
  const [refusal, setRefusal] = useState<string | null>(null);
  useEffect(() => {
    const saved = userId
      ? readPendingCompetitorAccept(projectId, userId, run.id)
      : null;
    setPendingInput(saved);
    setReceiptLoaded(true);
    setStoredForReload(Boolean(saved));
    if (saved)
      setDraft((current) => ({
        ...current,
        ...Object.fromEntries(
          saved.selections.map((selection) => [
            selection.candidateId,
            {
              selected: true,
              name: selection.name,
              notes: selection.notes,
            },
          ]),
        ),
      }));
  }, [projectId, userId, run.id]);
  const mutation = useMutation({
    mutationFn: (input: AcceptCompetitorResearchInput) =>
      acceptCompetitorResearch({ data: input }),
    onSuccess: (result) => {
      if (result.ok) {
        setReceipt(result);
        setRefusal(null);
      } else {
        setRefusal(result.code);
      }
      setPendingInput(null);
      setStoredForReload(false);
      if (userId) clearPendingCompetitorAccept(projectId, userId, run.id);
      onRefresh();
    },
  });
  const stale = contextVersion !== run.snapshot.contextVersion;
  const reviewable =
    receiptLoaded &&
    Boolean(userId) &&
    run.canAccept &&
    run.state === "finished" &&
    !stale &&
    !receipt?.ok;
  const submit = (confirmedEmpty = false) => {
    if (mutation.isPending || !userId) return;
    if (pendingInput) {
      mutation.mutate(pendingInput);
      return;
    }
    if (!reviewable) return;
    const selections = run.candidates
      .filter((candidate) => draft[candidate.id]?.selected)
      .map((candidate) => ({
        candidateId: candidate.id,
        name: draft[candidate.id]?.name.trim() ?? candidate.name,
        notes: draft[candidate.id]?.notes.trim() ?? "",
      }));
    if (selections.length === 0 && !confirmedEmpty) {
      setConfirmEmpty(true);
      return;
    }
    const input = {
      projectId,
      runId: run.id,
      mutationId: crypto.randomUUID(),
      expectedContextVersion: contextVersion,
      selections,
    };
    setPendingInput(input);
    setStoredForReload(
      savePendingCompetitorAccept(projectId, userId, run.id, input),
    );
    mutation.mutate(input);
  };

  return (
    <div className="space-y-3 border-t border-border pt-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h4 className="text-sm font-medium">
          Run {new Date(run.createdAtMs).toISOString().slice(0, 10)}
        </h4>
        <span className="text-xs text-muted-foreground">
          {run.outcome ?? run.state}
        </span>
      </div>
      {run.reasons.length ? (
        <p className="text-sm text-muted-foreground">
          Reason: {run.reasons.join(", ")}
        </p>
      ) : null}
      <p className="text-xs text-muted-foreground">
        Known provider cost:{" "}
        {run.knownCostUsd === null
          ? run.modelIncludedInSubscription
            ? "included in subscription"
            : "not reported"
          : `$${run.knownCostUsd.toFixed(4)}`}
        {run.costComplete ? "" : " (incomplete)"}
        {run.modelIncludedInSubscription && run.knownCostUsd !== null
          ? ", with the AI model included in subscription"
          : ""}
        . Billing: {run.billingState.replaceAll("_", " ")}. The 2,000-token
        setting limits requested model output, not input, reasoning or dollars.
      </p>
      {run.outcome === "unknown" ||
      run.outcome === "partial" ||
      !run.costComplete ? (
        <p role="status" className="text-sm text-amber-700 dark:text-amber-300">
          This run has incomplete evidence or an uncertain provider outcome.
          Review only the sourced suggestions shown here; an unknown operation
          may still have incurred cost.
        </p>
      ) : null}
      {run.state !== "finished" ? (
        <p role="status" className="text-sm">
          Research is in progress. Reading status does not start another paid
          request.
        </p>
      ) : null}
      {run.state === "finished" && run.candidates.length === 0 ? (
        <p className="text-sm">
          {run.outcome === "complete"
            ? "The completed search found no sourced business competitor to suggest."
            : "No reviewable sourced suggestions are available from this run."}
        </p>
      ) : null}
      {run.candidates.length ? (
        <ul className="space-y-3">
          {run.candidates.map((candidate) => (
            <CandidateReviewRow
              key={candidate.id}
              projectId={projectId}
              candidate={candidate}
              draft={
                draft[candidate.id] ?? {
                  selected: false,
                  name: candidate.name,
                  notes: candidate.notes,
                }
              }
              reviewable={reviewable}
              frozen={Boolean(pendingInput)}
              onChange={(next) =>
                setDraft((current) => ({ ...current, [candidate.id]: next }))
              }
            />
          ))}
        </ul>
      ) : null}
      {showStaleWarning(run, receipt, pendingInput, stale) ? (
        <p role="alert" className="text-sm">
          Project context changed since this run. Refresh and start a new run
          before accepting suggestions. Your selection draft stays here for
          review.
        </p>
      ) : null}
      {run.reviewState === "reviewed" && !receipt ? (
        <p className="text-sm">
          This run has a historical review receipt. Current saved competitors
          may have changed since it was reviewed.
        </p>
      ) : null}
      {receipt?.ok ? (
        <div role="status" className="text-sm">
          Historical receipt: {receipt.rows.length} selected,{" "}
          {receipt.rows.filter((row) => row.outcome === "added").length} added
          at context version {receipt.appliedContextVersion}
          {receipt.replayed ? " (replayed)" : ""}. Check the saved list for its
          current state.
        </div>
      ) : null}
      {refusal ? (
        <p role="alert" className="text-sm text-destructive">
          Review was not applied: {refusal}. The draft remains selected; refresh
          project context and review it again deliberately.
        </p>
      ) : null}
      {mutation.isError ? (
        <p role="alert" className="text-sm text-destructive">
          The review reply was not confirmed. Check the original receipt with
          the same mutation ID.
          {storedForReload
            ? " You can also reload this tab and check it here."
            : " Session storage is unavailable, so keep this tab open until the reply is known."}
        </p>
      ) : null}
      {pendingInput && !mutation.isError && !mutation.isPending ? (
        <p role="status" className="text-sm">
          An earlier review reply is unconfirmed. Check its original receipt
          before making a new selection.
        </p>
      ) : null}
      {pendingInput && userId && !receipt?.ok ? (
        <Button
          size="sm"
          variant="outline"
          pending={mutation.isPending}
          onClick={() => submit(true)}
        >
          Check original review receipt
        </Button>
      ) : reviewable ? (
        <div className="space-y-1">
          <Button
            size="sm"
            pending={mutation.isPending}
            onClick={() => submit()}
            disabled={run.candidates.some(
              (candidate) =>
                draft[candidate.id]?.selected &&
                !draft[candidate.id]?.name.trim(),
            )}
          >
            Continue with selected competitors
          </Button>
          <p className="text-xs text-muted-foreground">
            Continuing with none closes this run's review without adding a
            competitor. To edit a domain, use the manual form; it will not
            inherit this source verification.
          </p>
        </div>
      ) : null}
      {confirmEmpty ? (
        <ConfirmDialog
          title="Finish this review without additions?"
          confirmLabel="Finish without adding"
          onClose={() => setConfirmEmpty(false)}
          onConfirm={() => {
            setConfirmEmpty(false);
            submit(true);
          }}
        >
          This permanently closes review of this run. You cannot select its
          suggestions later; another research run may incur provider cost.
        </ConfirmDialog>
      ) : null}
    </div>
  );
}

function CandidateReviewRow({
  projectId,
  candidate,
  draft,
  reviewable,
  frozen,
  onChange,
}: {
  projectId: string;
  candidate: CompetitorResearchRun["candidates"][number];
  draft: Draft[string];
  reviewable: boolean;
  frozen: boolean;
  onChange: (next: Draft[string]) => void;
}) {
  return (
    <li className="space-y-2 rounded-md border border-border p-3">
      <div className="flex items-start gap-2">
        <input
          id={`candidate-${candidate.id}`}
          type="checkbox"
          checked={draft.selected}
          disabled={!reviewable || frozen}
          onChange={(event) =>
            onChange({ ...draft, selected: event.target.checked })
          }
        />
        <div className="min-w-0 space-y-1">
          <label
            htmlFor={`candidate-${candidate.id}`}
            className="text-sm font-medium"
          >
            {candidate.domain}
          </label>
          <div className="flex flex-wrap gap-x-3 text-xs">
            <a
              href={candidate.source.url}
              target="_blank"
              rel="noopener noreferrer"
              className="break-all underline"
            >
              Source page
            </a>
            <span>
              Captured{" "}
              {new Date(candidate.source.capturedAtMs)
                .toISOString()
                .slice(0, 10)}
            </span>
            {candidate.partialEvidence ? (
              <span>Partial page evidence</span>
            ) : null}
            <Link
              to="/p/$projectId/domain"
              params={{ projectId }}
              search={{ domain: candidate.domain }}
              className="underline"
            >
              Analyze domain
            </Link>
          </div>
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        {candidate.source.excerpt}
      </p>
      <p className="text-xs">Why suggested: {candidate.notes}</p>
      {draft.selected ? (
        <div className="grid gap-2 sm:grid-cols-2">
          <Input
            aria-label={`Name for ${candidate.domain}`}
            disabled={frozen}
            maxLength={120}
            value={draft.name}
            onChange={(event) =>
              onChange({ ...draft, name: event.target.value })
            }
          />
          <Input
            aria-label={`Notes for ${candidate.domain}`}
            disabled={frozen}
            maxLength={500}
            value={draft.notes}
            onChange={(event) =>
              onChange({ ...draft, notes: event.target.value })
            }
          />
        </div>
      ) : null}
    </li>
  );
}
