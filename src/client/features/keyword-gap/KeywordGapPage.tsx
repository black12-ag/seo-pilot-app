import { useState, type FormEvent } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ConfirmDialog } from "@/client/components/ConfirmDialog";
import { EmptyState } from "@/client/components/EmptyState";
import { PageHeader } from "@/client/components/PageHeader";
import { QueryError, QueryState } from "@/client/components/QueryState";
import { SkeletonCard } from "@/client/components/SkeletonPresets";
import { Alert, AlertDescription } from "@/client/components/ui/alert";
import { Button } from "@/client/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/client/components/ui/card";
import { Checkbox } from "@/client/components/ui/checkbox";
import { Input } from "@/client/components/ui/input";
import {
  getKeywordGapSetup,
  runKeywordGap,
} from "@/serverFunctions/keywordInsights";
import { aiMarketLabel } from "@/shared/ai-visibility";
import { domainField } from "@/types/schemas/domain";
import { KeywordGapResults } from "./KeywordGapResults";

const MAX_COMPETITORS = 3;

type Setup = Awaited<ReturnType<typeof getKeywordGapSetup>>;

export function KeywordGapPage({ projectId }: { projectId: string }) {
  const query = useQuery({
    queryKey: ["keyword-gap-setup", projectId],
    queryFn: () => getKeywordGapSetup({ data: { projectId } }),
  });

  return (
    <div className="overflow-auto px-4 py-4 pb-24 md:px-6 md:py-6 md:pb-8">
      <div className="mx-auto max-w-6xl space-y-4">
        <PageHeader
          title="Keyword gap"
          description="See which keywords competitors rank for that your site doesn't, and where you overlap."
        />
        <QueryState query={query} errorFallback="Couldn't load keyword gap.">
          {(setup) => <KeywordGapBody projectId={projectId} setup={setup} />}
        </QueryState>
      </div>
    </div>
  );
}

function NeedsSetup({
  projectId,
  reason,
}: {
  projectId: string;
  reason: "project_domain_missing" | "provider_not_configured";
}) {
  if (reason === "project_domain_missing") {
    return (
      <EmptyState
        title="Needs setup"
        description="Set this project's website to compare it with competitors."
        action={
          <Button
            nativeButton={false}
            render={<Link to="/p/$projectId/settings" params={{ projectId }} />}
          >
            Open settings
          </Button>
        }
      />
    );
  }
  return (
    <EmptyState
      title="Needs setup"
      description="Keyword data isn't connected on this server. An operator needs to add its API key."
    />
  );
}

function costText(setup: Setup, domainCount: number) {
  const { estimate } = setup;
  if (estimate.usdPerDomain == null) {
    return `This uses up to ${(estimate.creditsPerDomain * domainCount).toLocaleString()} credits.`;
  }
  return `This costs up to $${(estimate.usdPerDomain * domainCount).toFixed(2)} on your own data account.`;
}

function KeywordGapBody({
  projectId,
  setup,
}: {
  projectId: string;
  setup: Setup;
}) {
  const [selected, setSelected] = useState<string[]>([]);
  const [typed, setTyped] = useState<string[]>([]);
  const [draft, setDraft] = useState("");
  const [draftError, setDraftError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  const gap = useMutation({
    mutationFn: (competitors: string[]) =>
      runKeywordGap({
        data: { projectId, competitors, confirmedPaidWork: true },
      }),
  });

  if (!setup.projectDomain) {
    return <NeedsSetup projectId={projectId} reason="project_domain_missing" />;
  }
  if (!setup.providerConfigured) {
    return (
      <NeedsSetup projectId={projectId} reason="provider_not_configured" />
    );
  }

  const options = [
    ...setup.competitors,
    ...typed
      .filter((domain) =>
        setup.competitors.every((saved) => saved.domain !== domain),
      )
      .map((domain) => ({ domain, name: null })),
  ];
  const atLimit = selected.length >= MAX_COMPETITORS;

  function toggle(domain: string, checked: boolean) {
    setSelected((current) =>
      checked
        ? [...current, domain].slice(0, MAX_COMPETITORS)
        : current.filter((item) => item !== domain),
    );
  }

  function addTyped(event: FormEvent) {
    event.preventDefault();
    const parsed = domainField.safeParse(draft);
    if (!parsed.success) {
      setDraftError("Enter a valid domain like example.com");
      return;
    }
    if (parsed.data === setup.projectDomain) {
      setDraftError("That's this project's own domain.");
      return;
    }
    setDraftError(null);
    setDraft("");
    setTyped((current) => [...new Set([...current, parsed.data])]);
    if (!selected.includes(parsed.data)) toggle(parsed.data, true);
  }

  const result = gap.data;
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Compare {setup.projectDomain} with</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          <p>
            Market:{" "}
            <span className="font-medium">{aiMarketLabel(setup.market)}</span>
          </p>
          {setup.isProjectMarket ? null : (
            <Alert>
              <AlertDescription>
                Keyword data isn't available for this project's market, so this
                uses {aiMarketLabel(setup.market)} instead.
              </AlertDescription>
            </Alert>
          )}
          {options.length > 0 ? (
            <ul className="space-y-2">
              {options.map(({ domain, name }) => {
                const checked = selected.includes(domain);
                return (
                  <li key={domain}>
                    <label className="flex items-center gap-2">
                      <Checkbox
                        checked={checked}
                        disabled={!checked && atLimit}
                        onCheckedChange={(next) => toggle(domain, next)}
                      />
                      <span>{name ? `${name} (${domain})` : domain}</span>
                    </label>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="text-muted-foreground">
              No saved competitors yet. Type a domain below.
            </p>
          )}
          <form className="flex flex-wrap gap-2" onSubmit={addTyped}>
            <Input
              aria-label="Competitor domain"
              aria-invalid={draftError ? true : undefined}
              placeholder="competitor.com"
              className="max-w-xs"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
            />
            <Button type="submit" variant="outline" disabled={atLimit}>
              Add domain
            </Button>
          </form>
          {draftError ? (
            <p role="alert" className="text-destructive">
              {draftError}
            </p>
          ) : null}
          <div className="flex flex-wrap items-center gap-3">
            <Button
              disabled={selected.length === 0}
              pending={gap.isPending}
              onClick={() => setConfirming(true)}
            >
              Compare keywords
            </Button>
            <span className="text-muted-foreground">
              Choose 1 to {MAX_COMPETITORS} domains.
            </span>
          </div>
        </CardContent>
      </Card>

      {confirming ? (
        <ConfirmDialog
          title="Fetch ranking keywords?"
          confirmLabel="Compare keywords"
          onClose={() => setConfirming(false)}
          onConfirm={() => {
            setConfirming(false);
            gap.mutate(selected);
          }}
        >
          Checks up to {setup.estimate.rowsPerDomain} keywords for each of{" "}
          {selected.length + 1} domains. {costText(setup, selected.length + 1)}{" "}
          A domain fetched in the last 12 hours is reused at no charge.
        </ConfirmDialog>
      ) : null}

      {gap.isPending ? <SkeletonCard /> : null}
      {gap.isError ? (
        <QueryError
          error={gap.error}
          fallback="Couldn't compare these domains. Try again."
          onRetry={() => gap.mutate(gap.variables)}
          isRetrying={gap.isPending}
        />
      ) : null}
      {!gap.isPending && !gap.isError && result?.status === "needs_setup" ? (
        <NeedsSetup projectId={projectId} reason={result.reason} />
      ) : null}
      {!gap.isPending && !gap.isError && result?.status === "ready" ? (
        <KeywordGapResults result={result} />
      ) : null}
    </div>
  );
}
