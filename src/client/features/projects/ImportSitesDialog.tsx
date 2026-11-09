import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { projectsQueryOptions } from "@/client/features/projects/projectQueries";
import { QueryError } from "@/client/components/QueryState";
import { Spinner } from "@/client/components/Spinner";
import { Badge } from "@/client/components/ui/badge";
import { Button } from "@/client/components/ui/button";
import { Checkbox } from "@/client/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/client/components/ui/dialog";
import { GoogleGlyph } from "@/client/features/gsc/GoogleGlyph";
import { GoogleOAuthSetupWarning } from "@/client/features/integrations/GoogleOAuthSetupWarning";
import {
  startGoogleLink,
  useGoogleLinkPending,
} from "@/client/features/integrations/startGoogleLink";
import { getStandardErrorMessage } from "@/client/lib/error-messages";
import { importSites, listImportableSites } from "@/serverFunctions/siteImport";
import { HELP_PATHS } from "@/shared/product-help";

/** Where Google sends the person back to, with this dialog open again. */
const IMPORT_SITES_RETURN_PATH = "/projects?import=sites";

const IMPORTABLE_SITES_KEY = ["importableSites"];

type Listing = Awaited<ReturnType<typeof listImportableSites>>;
type Site = Listing["sites"][number];
type Results = Awaited<ReturnType<typeof importSites>>["results"];

function siteKey(site: Pick<Site, "accountId" | "siteUrl">) {
  return `${site.accountId} ${site.siteUrl}`;
}

function summarize(results: Results) {
  const created = results.filter((r) => r.status === "created");
  const notStarted = created.filter(
    (r) => r.initialAudit?.status === "unavailable",
  ).length;
  const skipped = results.length - created.length;
  if (created.length > 0)
    toast.success(
      `Imported ${created.length} ${created.length === 1 ? "site" : "sites"}`,
      {
        description:
          notStarted > 0
            ? `${notStarted} site ${notStarted === 1 ? "audit" : "audits"} could not start. Start them from Site Audit.`
            : "Their 50-page site audits are running.",
      },
    );
  if (skipped > 0)
    toast.info(
      `${skipped} ${skipped === 1 ? "site was" : "sites were"} skipped`,
      { description: "They already have a project, or are being imported." },
    );
}

export function ImportSitesDialog({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const linking = useGoogleLinkPending();
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const listing = useQuery({
    queryKey: IMPORTABLE_SITES_KEY,
    queryFn: () => listImportableSites(),
  });

  const importMutation = useMutation({
    mutationFn: (sites: Site[]) =>
      importSites({
        data: {
          sites: sites.map(({ accountId, siteUrl }) => ({
            accountId,
            siteUrl,
          })),
        },
      }),
    onSuccess: async ({ results }) => {
      await queryClient.invalidateQueries({
        queryKey: projectsQueryOptions().queryKey,
      });
      await queryClient.invalidateQueries({ queryKey: IMPORTABLE_SITES_KEY });
      summarize(results);
      onClose();
    },
    meta: { errorToast: false },
    onError: (error) => toast.error(getStandardErrorMessage(error)),
  });

  const data = listing.data;
  const importable = (data?.sites ?? []).filter(
    (site) => site.verified && !site.existingProject,
  );
  const chosen = importable.filter((site) => selected.has(siteKey(site)));
  const connect = () => void startGoogleLink("gsc", IMPORT_SITES_RETURN_PATH);

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !importMutation.isPending) onClose();
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Import my sites</DialogTitle>
          <DialogDescription>
            Make a project for each Search Console site, connected to Search
            Console, with its first 50-page site audit started.
          </DialogDescription>
        </DialogHeader>

        {listing.isPending ? (
          <Spinner size="sm" label="Loading your Search Console sites…" />
        ) : listing.isError ? (
          <QueryError
            error={listing.error}
            fallback="Couldn't load your Search Console sites."
            onRetry={() => void listing.refetch()}
            isRetrying={listing.isFetching}
          />
        ) : !data?.googleOAuthConfigured ? (
          <GoogleOAuthSetupWarning
            integrationName="Search Console"
            docsUrl={HELP_PATHS.searchConsole}
          />
        ) : !data.connected ? (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-muted-foreground">
              Connect Google first. SEO Pilot then lists the sites your Search
              Console account can see.
            </p>
            <Button
              className="self-start"
              onClick={connect}
              pending={linking}
              disabled={!data.canImport}
            >
              {linking ? null : <GoogleGlyph className="size-[18px]" />}
              {linking ? "Opening Google…" : "Connect Google"}
            </Button>
          </div>
        ) : (
          <SiteList
            data={data}
            selected={selected}
            onToggle={(key, on) =>
              setSelected((current) => {
                const next = new Set(current);
                if (on) next.add(key);
                else next.delete(key);
                return next;
              })
            }
            onReconnect={connect}
          />
        )}

        {data && !data.canImport ? (
          <p className="text-sm text-muted-foreground">
            Only an owner or admin can import sites.
          </p>
        ) : null}

        <DialogFooter>
          <Button
            variant="ghost"
            onClick={onClose}
            disabled={importMutation.isPending}
          >
            Cancel
          </Button>
          {data?.connected ? (
            <Button
              onClick={() => importMutation.mutate(chosen)}
              disabled={chosen.length === 0 || !data.canImport}
              pending={importMutation.isPending}
            >
              {chosen.length > 1
                ? `Import ${chosen.length} sites`
                : "Import site"}
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SiteList({
  data,
  selected,
  onToggle,
  onReconnect,
}: {
  data: Listing;
  selected: Set<string>;
  onToggle: (key: string, on: boolean) => void;
  onReconnect: () => void;
}) {
  const broken = data.accounts.filter(
    (account) => account.requiresReconnect || account.propertiesUnavailable,
  );
  return (
    <div className="flex flex-col gap-3">
      {broken.length > 0 ? (
        <p className="text-sm text-muted-foreground">
          {broken.length === 1
            ? "One Google account couldn't list its sites."
            : `${broken.length} Google accounts couldn't list their sites.`}{" "}
          <Button variant="link" className="h-auto p-0" onClick={onReconnect}>
            Reconnect Google
          </Button>
        </p>
      ) : null}
      {data.sites.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Your connected Google account has no Search Console sites yet.
        </p>
      ) : (
        <ul className="max-h-[min(50vh,24rem)] divide-y divide-border overflow-auto rounded-lg border border-border">
          {data.sites.map((site) => {
            const key = siteKey(site);
            const available = site.verified && !site.existingProject;
            return (
              <li key={key}>
                <label className="flex items-center gap-3 p-3 has-disabled:opacity-70">
                  <Checkbox
                    checked={available && selected.has(key)}
                    disabled={!available || !data.canImport}
                    onCheckedChange={(on) => onToggle(key, on)}
                    aria-label={`Import ${site.domain}`}
                  />
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-sm font-medium">
                      {site.domain}
                    </span>
                    <span className="truncate text-xs text-muted-foreground">
                      {site.siteUrl}
                      {site.email ? ` · ${site.email}` : ""}
                    </span>
                  </span>
                  {site.existingProject ? (
                    <Badge variant="secondary" size="sm">
                      {site.existingProject.archived
                        ? "Archived project"
                        : "Has a project"}
                    </Badge>
                  ) : !site.verified ? (
                    <Badge variant="outline" size="sm">
                      Not verified
                    </Badge>
                  ) : null}
                </label>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
