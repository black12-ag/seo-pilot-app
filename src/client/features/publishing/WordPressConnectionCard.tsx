import { useState } from "react";
import { revalidateLogic } from "@tanstack/react-form";
import { Link } from "@tanstack/react-router";
import { useMutation } from "@tanstack/react-query";
import { CardShell } from "@/client/components/CardShell";
import { ConfirmDialog } from "@/client/components/ConfirmDialog";
import { PermissionHint } from "@/client/components/PermissionHint";
import { useAppForm } from "@/client/components/form/useAppForm";
import { Badge } from "@/client/components/ui/badge";
import { Button } from "@/client/components/ui/button";
import { getStandardErrorMessage } from "@/client/lib/error-messages";
import {
  checkWordPressGrant,
  connectWordPress,
  disconnectWordPress,
  revokeWordPressGrant,
} from "@/serverFunctions/publishing";
import {
  connectWordPressInputSchema,
  type ConnectionOutcome,
  type PublishingStatus,
  type WordPressGrant,
} from "@/types/schemas/publishing";
import { refusalLabel } from "./publishingCopy";

const formSchema = connectWordPressInputSchema.omit({ projectId: true });

function GrantRow({
  label,
  grant,
  connection,
  busy,
  onCheck,
  onRevoke,
  canManage,
}: {
  label: string;
  grant: WordPressGrant;
  connection: NonNullable<PublishingStatus["connection"]>;
  busy: boolean;
  onCheck: (grant: WordPressGrant) => void;
  onRevoke: (grant: WordPressGrant) => void;
  canManage: boolean;
}) {
  const { status, checkedAtMs } = connection[grant];
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3">
      <div>
        <p className="font-medium">{label}</p>
        <p className="text-xs text-muted-foreground">
          {checkedAtMs
            ? `Last changed ${new Date(checkedAtMs).toLocaleString()}`
            : "Not checked yet"}
        </p>
      </div>
      <div className="flex items-center gap-2">
        <Badge variant="outline">{status}</Badge>
        {canManage ? (
          <>
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => onCheck(grant)}
            >
              Check
            </Button>
            {status === "granted" ? (
              <Button
                size="sm"
                variant="ghost"
                disabled={busy}
                onClick={() => onRevoke(grant)}
              >
                Turn off
              </Button>
            ) : null}
          </>
        ) : null}
      </div>
    </div>
  );
}

export function WordPressConnectionCard({
  projectId,
  status,
  onChanged,
}: {
  projectId: string;
  status: PublishingStatus;
  onChanged: () => Promise<unknown>;
}) {
  const [message, setMessage] = useState<string | null>(null);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const report = (outcome: ConnectionOutcome) =>
    setMessage(
      outcome.status === "refused" ? refusalLabel(outcome.reason) : null,
    );
  const failed = (error: unknown) =>
    setMessage(getStandardErrorMessage(error, "That didn't work. Try again."));
  const check = useMutation({
    mutationFn: (grant: WordPressGrant) =>
      checkWordPressGrant({ data: { projectId, grant } }),
    onSuccess: report,
    onError: failed,
    onSettled: onChanged,
  });
  const revoke = useMutation({
    mutationFn: (grant: WordPressGrant) =>
      revokeWordPressGrant({ data: { projectId, grant } }),
    onError: failed,
    onSettled: onChanged,
  });
  const disconnect = useMutation({
    mutationFn: () => disconnectWordPress({ data: { projectId } }),
    onError: failed,
    onSettled: async () => {
      setConfirmDisconnect(false);
      await onChanged();
    },
  });
  const connect = useMutation({
    mutationFn: (value: {
      siteUrl: string;
      username: string;
      applicationPassword: string;
    }) => connectWordPress({ data: { projectId, ...value } }),
    onSuccess: report,
    onError: failed,
    onSettled: onChanged,
  });
  const form = useAppForm({
    defaultValues: {
      siteUrl: status.authority.origin ?? "",
      username: "",
      applicationPassword: "",
    },
    validationLogic: revalidateLogic(),
    validators: { onDynamic: formSchema },
    onSubmit: async ({ value, formApi }) => {
      await connect.mutateAsync(value);
      formApi.setFieldValue("applicationPassword", "");
    },
  });
  const busy =
    check.isPending ||
    revoke.isPending ||
    disconnect.isPending ||
    connect.isPending;
  const needsSetup = !status.transportAvailable || !status.encryptionAvailable;

  return (
    <CardShell
      title="Connect WordPress"
      titleInfo={
        needsSetup ? <Badge variant="outline">Needs setup</Badge> : undefined
      }
    >
      <div className="max-w-3xl space-y-4 text-sm">
        <p className="text-muted-foreground">
          Use an application password from your WordPress profile. We save it
          encrypted and only ever create drafts. We never publish a post.
        </p>
        {!status.transportAvailable ? (
          <p role="status" className="rounded-lg border bg-muted/40 p-3">
            {refusalLabel("transport_unavailable")}
          </p>
        ) : null}
        {!status.encryptionAvailable ? (
          <p role="status" className="rounded-lg border bg-muted/40 p-3">
            {refusalLabel("encryption_unavailable")}
          </p>
        ) : null}
        {!status.authority.verified ? (
          <p role="status" className="rounded-lg border bg-muted/40 p-3">
            {refusalLabel("site_not_verified")}{" "}
            <Link
              to="/p/$projectId/settings"
              params={{ projectId }}
              hash="site-authority"
              className="underline"
            >
              Open settings
            </Link>
          </p>
        ) : null}
        {message ? (
          <p role="status" className="rounded-lg border bg-muted/40 p-3">
            {message}
          </p>
        ) : null}
        {status.connection ? (
          <div className="space-y-3">
            <p className="break-all font-mono">{status.connection.origin}</p>
            <GrantRow
              label="Read access"
              grant="read"
              connection={status.connection}
              busy={busy}
              canManage={status.canManage}
              onCheck={check.mutate}
              onRevoke={revoke.mutate}
            />
            <GrantRow
              label="Write access"
              grant="write"
              connection={status.connection}
              busy={busy}
              canManage={status.canManage}
              onCheck={check.mutate}
              onRevoke={revoke.mutate}
            />
            <p className="text-xs text-muted-foreground">
              Checking write access only reads your account's permissions. It
              doesn't create anything on your site.
            </p>
          </div>
        ) : null}
        {!status.canManage ? (
          <PermissionHint action="connect WordPress" />
        ) : status.authority.verified && !needsSetup ? (
          <form.AppForm>
            <form.Form className="space-y-4 border-t pt-4">
              <form.AppField name="siteUrl">
                {(field) => (
                  <field.TextField
                    label="Site address"
                    placeholder="https://example.com"
                    disabled={busy}
                  />
                )}
              </form.AppField>
              <form.AppField name="username">
                {(field) => (
                  <field.TextField label="Username" disabled={busy} />
                )}
              </form.AppField>
              <form.AppField name="applicationPassword">
                {(field) => (
                  <field.TextField
                    label="Application password"
                    type="password"
                    autoComplete="off"
                    description={
                      status.connection
                        ? "Saving a new password turns off read and write until you check them again."
                        : undefined
                    }
                    disabled={busy}
                  />
                )}
              </form.AppField>
              <form.SubmitButton disabled={busy}>
                {status.connection ? "Replace password" : "Connect WordPress"}
              </form.SubmitButton>
            </form.Form>
          </form.AppForm>
        ) : null}
        {status.connection && status.canManage ? (
          <div className="flex justify-end border-t pt-4">
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => setConfirmDisconnect(true)}
            >
              Disconnect
            </Button>
          </div>
        ) : null}
      </div>
      {confirmDisconnect ? (
        <ConfirmDialog
          title="Disconnect WordPress?"
          confirmLabel="Disconnect"
          destructive
          pending={disconnect.isPending}
          onClose={() => setConfirmDisconnect(false)}
          onConfirm={() => disconnect.mutate()}
        >
          We'll delete the saved password here. It keeps working on your site
          until you revoke it in your WordPress profile. Drafts already sent
          stay on your site.
        </ConfirmDialog>
      ) : null}
    </CardShell>
  );
}
