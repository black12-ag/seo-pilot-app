import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { CardShell } from "@/client/components/CardShell";
import { Button } from "@/client/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/client/components/ui/select";
import { contentListQuery } from "@/client/features/content/contentQueries";
import { getStandardErrorMessage } from "@/client/lib/error-messages";
import {
  previewWordPressDraft,
  publishWordPressDraft,
} from "@/serverFunctions/publishing";
import type { PublishOutcome } from "@/types/schemas/publishing";
import { refusalLabel, stateHelp, stateLabels } from "./publishingCopy";

function outcomeText(outcome: PublishOutcome) {
  if (outcome.status === "refused") return refusalLabel(outcome.reason);
  const { state } = outcome.record;
  return `${stateLabels[state]}. ${stateHelp[state]}`;
}

export function SendDraftCard({
  projectId,
  onChanged,
}: {
  projectId: string;
  onChanged: () => Promise<unknown>;
}) {
  const [contentId, setContentId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const approved = useQuery(
    contentListQuery({ projectId, state: "approved", limit: 100 }),
  );
  const preview = useMutation({
    mutationFn: (id: string) =>
      previewWordPressDraft({ data: { projectId, contentId: id } }),
    onError: (error) =>
      setMessage(getStandardErrorMessage(error, "Couldn't load the preview.")),
  });
  const ready = preview.data?.status === "ready" ? preview.data : null;
  const send = useMutation({
    mutationFn: async () => {
      if (!ready || !contentId) throw new Error("Preview the draft first.");
      return publishWordPressDraft({
        data: {
          projectId,
          contentId,
          revisionId: ready.revisionId,
          expectedHeadVersion: ready.headVersion,
          expectedContentHash: ready.contentHash,
        },
      });
    },
    onSuccess: (outcome) => {
      setMessage(outcomeText(outcome));
      preview.reset();
    },
    onError: (error) =>
      setMessage(
        getStandardErrorMessage(error, "We don't know if that was sent."),
      ),
    onSettled: onChanged,
  });
  const items = approved.data?.items ?? [];

  return (
    <CardShell title="Send a draft">
      <div className="max-w-3xl space-y-4 text-sm">
        <p className="text-muted-foreground">
          Only approved content can go out. It arrives as a WordPress draft and
          stays private until you publish it there.
        </p>
        {message ? (
          <p role="status" className="rounded-lg border bg-muted/40 p-3">
            {message}
          </p>
        ) : null}
        {approved.isError ? (
          <p role="status">Couldn't load approved content.</p>
        ) : items.length === 0 ? (
          <p className="text-muted-foreground">
            {approved.isLoading ? "Loading…" : "No approved content yet."}
          </p>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <Select
              value={contentId}
              onValueChange={(value) => {
                setContentId(value);
                setMessage(null);
                preview.reset();
              }}
              items={items.map((item) => ({
                value: item.id,
                label: item.title || item.topic,
              }))}
            >
              <SelectTrigger className="min-w-64">
                <SelectValue placeholder="Choose content" />
              </SelectTrigger>
              <SelectContent>
                {items.map((item) => (
                  <SelectItem key={item.id} value={item.id}>
                    {item.title || item.topic}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              variant="outline"
              disabled={!contentId || preview.isPending}
              onClick={() => {
                if (contentId) preview.mutate(contentId);
              }}
            >
              See what will be sent
            </Button>
          </div>
        )}
        {preview.data?.status === "blocked" ? (
          <p role="status" className="rounded-lg border bg-muted/40 p-3">
            {refusalLabel(preview.data.reason)}
          </p>
        ) : null}
        {ready ? (
          <div className="space-y-3 border-t pt-4">
            <dl className="grid gap-3 sm:grid-cols-2">
              <div>
                <dt className="text-xs text-muted-foreground">Destination</dt>
                <dd className="mt-1 break-all font-mono">{ready.origin}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Slug</dt>
                <dd className="mt-1 break-all font-mono">
                  {ready.slug || "Set by WordPress"}
                </dd>
              </div>
              <div className="sm:col-span-2">
                <dt className="text-xs text-muted-foreground">Title</dt>
                <dd className="mt-1">{ready.title}</dd>
              </div>
            </dl>
            <pre className="max-h-80 overflow-auto rounded-lg border bg-muted/40 p-3 text-xs whitespace-pre-wrap">
              {ready.html}
            </pre>
            {ready.record ? (
              <p className="text-muted-foreground">
                Already recorded: {stateLabels[ready.record.state]}.{" "}
                {stateHelp[ready.record.state]}
              </p>
            ) : null}
            <Button pending={send.isPending} onClick={() => send.mutate()}>
              {ready.record ? "Send again" : "Send as draft"}
            </Button>
          </div>
        ) : null}
      </div>
    </CardShell>
  );
}
