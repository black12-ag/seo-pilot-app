import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { CardShell } from "@/client/components/CardShell";
import { ConfirmDialog } from "@/client/components/ConfirmDialog";
import { Badge } from "@/client/components/ui/badge";
import { Button } from "@/client/components/ui/button";
import {
  Table,
  TableBody,
  TableCard,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/client/components/ui/table";
import { getStandardErrorMessage } from "@/client/lib/error-messages";
import {
  reconcileWordPressRecord,
  trashWordPressRecord,
} from "@/serverFunctions/publishing";
import type {
  PublishOutcome,
  PublishRecordView,
  PublishState,
} from "@/types/schemas/publishing";
import { refusalLabel, stateHelp, stateLabels } from "./publishingCopy";

const checkable: PublishState[] = [
  "sending",
  "uncertain",
  "verified",
  "mismatch",
  "trashing",
  "trash_uncertain",
];
const trashable: PublishState[] = ["verified", "mismatch"];

export function PublishRecordsTable({
  projectId,
  records,
  canManage,
  onChanged,
}: {
  projectId: string;
  records: PublishRecordView[];
  canManage: boolean;
  onChanged: () => Promise<unknown>;
}) {
  const [message, setMessage] = useState<string | null>(null);
  const [confirmTrash, setConfirmTrash] = useState<PublishRecordView | null>(
    null,
  );
  const report = (outcome: PublishOutcome) =>
    setMessage(
      outcome.status === "refused" ? refusalLabel(outcome.reason) : null,
    );
  const failed = (error: unknown) =>
    setMessage(getStandardErrorMessage(error, "That didn't work. Try again."));
  const reconcile = useMutation({
    mutationFn: (recordId: string) =>
      reconcileWordPressRecord({ data: { projectId, recordId } }),
    onSuccess: report,
    onError: failed,
    onSettled: onChanged,
  });
  const trash = useMutation({
    mutationFn: (recordId: string) =>
      trashWordPressRecord({ data: { projectId, recordId } }),
    onSuccess: report,
    onError: failed,
    onSettled: async () => {
      setConfirmTrash(null);
      await onChanged();
    },
  });
  const busy = reconcile.isPending || trash.isPending;

  return (
    <CardShell title="Sent drafts">
      <div className="space-y-3 text-sm">
        {message ? (
          <p role="status" className="rounded-lg border bg-muted/40 p-3">
            {message}
          </p>
        ) : null}
        {records.length === 0 ? (
          <p className="text-muted-foreground">No drafts sent yet.</p>
        ) : (
          <TableCard>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Title</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>On the site</TableHead>
                  <TableHead>Sent</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {records.map((record) => (
                  <TableRow key={record.id}>
                    <TableCell className="max-w-64 whitespace-normal">
                      {record.title || "Erased"}
                    </TableCell>
                    <TableCell className="max-w-72 whitespace-normal">
                      <Badge variant="outline">
                        {stateLabels[record.state]}
                      </Badge>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {stateHelp[record.state]}
                        {record.mismatchFields.length > 0
                          ? ` Differs: ${record.mismatchFields.join(", ")}.`
                          : ""}
                        {record.failureCode
                          ? ` Code: ${record.failureCode}.`
                          : ""}
                      </p>
                    </TableCell>
                    <TableCell className="text-xs">
                      {record.remotePostId
                        ? `Post ${record.remotePostId}${record.remoteRevisionId ? `, revision ${record.remoteRevisionId}` : ""}`
                        : "Not known"}
                    </TableCell>
                    <TableCell className="text-xs">
                      {new Date(record.lastAttemptAtMs).toLocaleString()}
                    </TableCell>
                    <TableCell className="text-right whitespace-nowrap">
                      {canManage && checkable.includes(record.state) ? (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={busy}
                          onClick={() => reconcile.mutate(record.id)}
                        >
                          Check the site
                        </Button>
                      ) : null}
                      {canManage && trashable.includes(record.state) ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="ml-2"
                          disabled={busy}
                          onClick={() => setConfirmTrash(record)}
                        >
                          Move to trash
                        </Button>
                      ) : null}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableCard>
        )}
      </div>
      {confirmTrash ? (
        <ConfirmDialog
          title="Move this draft to the WordPress trash?"
          confirmLabel="Move to trash"
          destructive
          pending={trash.isPending}
          onClose={() => setConfirmTrash(null)}
          onConfirm={() => trash.mutate(confirmTrash.id)}
        >
          We only do this if it's still our unedited draft. You can restore it
          from the trash in WordPress.
        </ConfirmDialog>
      ) : null}
    </CardShell>
  );
}
