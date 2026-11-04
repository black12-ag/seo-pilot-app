import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { SectionHeader } from "@/client/components/PageHeader";
import { Alert, AlertDescription } from "@/client/components/ui/alert";
import { Badge } from "@/client/components/ui/badge";
import { Button } from "@/client/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/client/components/ui/select";
import {
  getErrorCode,
  getStandardErrorMessage,
} from "@/client/lib/error-messages";
import {
  getAiEngineSettings,
  setAiEngine,
  testAiEngine,
} from "@/serverFunctions/aiEngine";
import type { AiEngineSettingsView } from "@/server/lib/aiEngine/settings";

type Status = Extract<AiEngineSettingsView, { state: "ready" }>["status"];
type EngineId = "api" | "agy" | "claude" | "codex";

const QUERY_KEY = ["ai-engine-settings"];
const ENGINE_LABELS: Record<EngineId, string> = {
  api: "API key (OpenRouter)",
  agy: "agy (Antigravity CLI)",
  claude: "claude (Claude Code)",
  codex: "codex (Codex CLI)",
};
const ENGINE_IDS: EngineId[] = ["api", "agy", "claude", "codex"];
const CHECK_LABELS = [
  ["read", "Files"],
  ["command", "Commands"],
  ["web", "Web"],
  ["tools", "Tools"],
] as const;

const isEngineId = (value: string): value is EngineId =>
  ENGINE_IDS.some((id) => id === value);

function SetupSteps({ apiKeySet }: { apiKeySet: boolean }) {
  return (
    <div className="space-y-2 text-sm text-muted-foreground">
      <p>
        {apiKeySet
          ? "AI runs on your OpenRouter API key."
          : "No AI is set up yet."}{" "}
        To use your own logged-in agy, claude or codex instead, run the AI
        engine service on your server and set <code>AI_ENGINE_URL</code> and{" "}
        <code>AI_ENGINE_TOKEN</code>. The steps are in{" "}
        <code>docs/AI_ENGINE.md</code>.
      </p>
      <p>
        Subscription logins are for your own use. Check your provider&apos;s
        terms, and don&apos;t serve paying customers from one.
      </p>
    </div>
  );
}

function EngineFacts({ status, engine }: { status: Status; engine: EngineId }) {
  const detail = engine === "api" ? null : status.engines[engine];
  if (!detail) return null;
  return (
    <div className="space-y-2 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={detail.installed ? "secondary" : "outline"}>
          {detail.installed
            ? `Installed${detail.version ? ` (${detail.version})` : ""}`
            : "Not installed"}
        </Badge>
        <Badge variant={detail.signedIn ? "secondary" : "outline"}>
          {detail.signedIn ? "Signed in" : "Not signed in"}
        </Badge>
        {detail.verified ? null : <Badge variant="outline">Not verified</Badge>}
      </div>
      <p className="text-muted-foreground">{detail.lockdown.message}</p>
      {detail.lockdown.checks ? (
        <ul className="flex flex-wrap gap-x-4 text-muted-foreground">
          {CHECK_LABELS.map(([check, label]) => (
            <li key={check}>
              {label}: {detail.lockdown.checks?.[check]}
            </li>
          ))}
        </ul>
      ) : null}
      {detail.versionWarning ? (
        <Alert variant="warning">
          <AlertDescription className="text-foreground">
            {detail.versionWarning}
          </AlertDescription>
        </Alert>
      ) : null}
    </div>
  );
}

function ReadySettings({
  status,
  apiKeySet,
}: {
  status: Status;
  apiKeySet: boolean;
}) {
  const queryClient = useQueryClient();
  const refresh = () => queryClient.invalidateQueries({ queryKey: QUERY_KEY });
  const current: EngineId = isEngineId(status.engine) ? status.engine : "api";
  const [engine, setEngine] = useState<EngineId>(current);
  const [model, setModel] = useState<string | null>(status.model);
  useEffect(() => {
    setEngine(current);
    setModel(status.model);
  }, [current, status.model]);
  const detail = engine === "api" ? null : status.engines[engine];
  const models = detail?.models ?? [];
  const save = useMutation({
    mutationFn: () => setAiEngine({ data: { engine, model } }),
    onSuccess: refresh,
  });
  const runTest = useMutation({
    mutationFn: () => testAiEngine({ data: { engine } }),
    onSettled: refresh,
  });
  const changed = engine !== current || model !== status.model;
  const items = ENGINE_IDS.map((value) => ({
    value,
    label: ENGINE_LABELS[value],
  }));

  return (
    <div className="space-y-4">
      <dl className="grid gap-1 text-sm sm:grid-cols-[10rem_1fr]">
        <dt className="text-muted-foreground">Service</dt>
        <dd>Reachable</dd>
        <dt className="text-muted-foreground">Running on</dt>
        <dd>
          {ENGINE_LABELS[current]}
          {status.model ? `, ${status.model}` : ""}
        </dd>
        <dt className="text-muted-foreground">State</dt>
        <dd>
          {current === "api"
            ? apiKeySet
              ? "Ready"
              : "Needs setup: OPENROUTER_API_KEY isn't set"
            : status.usable
              ? "Ready"
              : "Off until its lockdown test passes"}
        </dd>
      </dl>
      {status.message ? (
        <Alert variant="warning">
          <AlertDescription className="text-foreground">
            {status.message}
          </AlertDescription>
        </Alert>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <Select
          value={engine}
          items={items}
          onValueChange={(value) => {
            if (typeof value !== "string" || !isEngineId(value)) return;
            setEngine(value);
            setModel(
              value === "api"
                ? null
                : (status.engines[value]?.defaultModel ?? null),
            );
          }}
        >
          <SelectTrigger className="min-w-60" aria-label="AI engine">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {items.map((item) => (
              <SelectItem key={item.value} value={item.value}>
                {item.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {engine !== "api" ? (
          <Select
            value={model}
            items={models.map((value) => ({ value, label: value }))}
            onValueChange={(value) =>
              setModel(typeof value === "string" ? value : null)
            }
          >
            <SelectTrigger className="min-w-60" aria-label="Model">
              <SelectValue placeholder="Choose a model" />
            </SelectTrigger>
            <SelectContent>
              {models.map((value) => (
                <SelectItem key={value} value={value}>
                  {value}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}
        <Button
          disabled={!changed}
          pending={save.isPending}
          onClick={() => save.mutate()}
        >
          Save
        </Button>
        {engine !== "api" ? (
          <Button
            variant="outline"
            pending={runTest.isPending}
            onClick={() => runTest.mutate()}
          >
            Test
          </Button>
        ) : null}
      </div>
      <EngineFacts status={status} engine={engine} />
      {save.isError ? (
        <p className="text-sm text-destructive">
          {getStandardErrorMessage(save.error, "We couldn't save your choice.")}
        </p>
      ) : null}
      {runTest.data ? (
        <p
          role="status"
          className={
            runTest.data.passed ? "text-sm" : "text-sm text-destructive"
          }
        >
          {runTest.data.message}
        </p>
      ) : null}
      {runTest.isError ? (
        <p className="text-sm text-destructive">
          {getStandardErrorMessage(runTest.error, "The test couldn't run.")}
        </p>
      ) : null}
      <p className="text-sm text-muted-foreground">
        A subscription has no per-call price, and its plan limits apply. Logins
        are for your own use: check your provider&apos;s terms, and don&apos;t
        serve paying customers from one. A test or a switch uses a small amount
        of your plan.
      </p>
    </div>
  );
}

/** How this installation runs AI. Owners and admins only. */
export function AiEngineSettings() {
  const query = useQuery({
    queryKey: QUERY_KEY,
    queryFn: () => getAiEngineSettings(),
    retry: false,
    // A lockdown test runs in the background after a switch.
    refetchInterval: (latest) => {
      const data = latest.state.data;
      return data?.state === "ready" &&
        Object.values(data.status.engines).some(
          (engine) => engine.lockdown.state === "running",
        )
        ? 5000
        : false;
    },
  });
  const forbidden = getErrorCode(query.error) === "FORBIDDEN";
  return (
    <section className="space-y-3">
      <SectionHeader title="AI engine" />
      {query.isPending ? (
        <p className="text-sm text-muted-foreground">Checking your AI setup.</p>
      ) : null}
      {forbidden ? (
        <p className="text-sm text-muted-foreground">
          Only an owner or admin can see or change how AI runs.
        </p>
      ) : query.isError ? (
        <p className="text-sm text-destructive">
          We couldn&apos;t load your AI setup.
        </p>
      ) : null}
      {query.data?.state === "hosted" ? (
        <p className="text-sm text-muted-foreground">
          A paid hosted service serving customers can&apos;t use a personal
          subscription, so this installation runs on its API key.
        </p>
      ) : null}
      {query.data?.state === "not_configured" ? (
        <SetupSteps apiKeySet={query.data.apiKeySet} />
      ) : null}
      {query.data?.state === "unreachable" ? (
        <div className="space-y-2">
          <Alert variant="warning">
            <AlertDescription className="text-foreground">
              {query.data.message} AI stays off until it is back, so your API
              key isn&apos;t spent by surprise. Start the service, or remove{" "}
              <code>AI_ENGINE_URL</code> to use the API key.
            </AlertDescription>
          </Alert>
          <Button
            variant="outline"
            pending={query.isFetching}
            onClick={() => void query.refetch()}
          >
            Check again
          </Button>
        </div>
      ) : null}
      {query.data?.state === "ready" ? (
        <ReadySettings
          status={query.data.status}
          apiKeySet={query.data.apiKeySet}
        />
      ) : null}
    </section>
  );
}
