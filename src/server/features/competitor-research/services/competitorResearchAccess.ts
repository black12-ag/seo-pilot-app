import { checkUsageCreditsDepleted } from "@/server/billing/subscription";
import { hasDataforseoAccess } from "@/server/lib/provider-access";
import {
  aiAccessKind,
  aiBackendId,
  isSubscriptionBackend,
} from "@/server/lib/aiEngine/billing";
import { buildChatAgentModel, resolveAiAccess } from "@/server/lib/openrouter";
import {
  getOptionalEnvValue,
  isHostedServerAuthMode,
  usesBetterAuthServer,
} from "@/server/lib/runtime-env";
import { sha256Hex } from "@/server/lib/audit/ids";
import { CompetitorResearchRepository as repository } from "../repositories/CompetitorResearchRepository";
import type { CompetitorResearchActor } from "@/types/schemas/competitorResearch";

export const competitorLimits = {
  profile: "competitor-discovery-v1",
  maxQueries: 2,
  searchDepth: 10,
  maxCandidateSites: 5,
  maxPages: 6,
  maxPublicHttpRequests: 24,
  maxModelCalls: 1,
  maxModelRequestBytes: 32768,
  maxModelOutputJsonBytes: 16384,
  requestedOutputTokens: 2000,
  maxRendererAttempts: 0,
  maxPaidRetries: 0,
  maxRunDurationMs: 240000,
} as const;

export async function competitorExecutionConfiguration() {
  const durableAuthority = await usesBetterAuthServer();
  const [search, modelName] = await Promise.all([
    durableAuthority ? hasDataforseoAccess() : Promise.resolve(false),
    getOptionalEnvValue("OPENROUTER_MODEL"),
  ]);
  const access = durableAuthority ? await resolveAiAccess() : null;
  const modelConfigured = Boolean(access);
  const backendId = aiBackendId(access);
  const modelConfigurationHash = await sha256Hex(
    JSON.stringify({
      backendId,
      accessKind: aiAccessKind(access),
      requestedModelId: access
        ? buildChatAgentModel(access, modelName, "low").modelId
        : null,
      profile: competitorLimits.profile,
    }),
  );
  return {
    durableAuthority,
    search,
    modelConfigured,
    backendId,
    modelConfigurationHash,
  };
}

export async function competitorCapability(
  actor: CompetitorResearchActor,
  domain: string | null,
) {
  const {
    durableAuthority,
    search,
    modelConfigured,
    backendId,
    modelConfigurationHash,
  } = await competitorExecutionConfiguration();
  const blockedReasons: Array<
    | "unsupported_background_authority"
    | "project_domain_missing"
    | "dataforseo_not_configured"
    | "model_not_configured"
    | "insufficient_credits"
  > = [];
  if (!durableAuthority)
    blockedReasons.push("unsupported_background_authority");
  if (!domain) blockedReasons.push("project_domain_missing");
  if (!search) blockedReasons.push("dataforseo_not_configured");
  if (!modelConfigured) blockedReasons.push("model_not_configured");
  if ((await isHostedServerAuthMode()) && durableAuthority) {
    const credit = await checkUsageCreditsDepleted({
      organizationId: actor.organizationId,
      userId: actor.userId,
      userEmail: actor.userEmail,
    });
    if (credit.depleted) blockedReasons.push("insufficient_credits");
  }
  const capabilityFingerprint = await sha256Hex(
    JSON.stringify({ blockedReasons, backendId, modelConfigurationHash }),
  );
  return {
    blockedReasons,
    capabilityFingerprint,
    modelConfigurationHash,
    modelBackendId: backendId,
    model: {
      backendId,
      configured: modelConfigured,
      authorizedForCaller: durableAuthority && modelConfigured,
      usageBasis: isSubscriptionBackend(backendId)
        ? ("quota" as const)
        : ("usd" as const),
      outputTokenLimitSupported: modelConfigured,
    },
  };
}

export type CompetitorOperationSlot =
  | "own_page"
  | "search_0"
  | "search_1"
  | "page_0"
  | "page_1"
  | "page_2"
  | "page_3"
  | "page_4"
  | "classify";

export async function currentCompetitorAuthority(runId: string) {
  const current = await repository.getAuthority(runId);
  if (!current) return null;
  const data = await repository.getRun(
    current.scope,
    current.run.projectId,
    runId,
  );
  return { ...current, data };
}

export function competitorDeadlineSignal(deadlineAtMs: number, maxMs: number) {
  const remaining = deadlineAtMs - Date.now();
  if (remaining <= 0) throw new Error("deadline");
  return AbortSignal.timeout(Math.min(remaining, maxMs));
}

export async function issueCompetitorOperation(
  runId: string,
  slot: CompetitorOperationSlot,
  input: { queryText?: string; targetUrl?: string },
  configurationHash: string,
) {
  const current = await currentCompetitorAuthority(runId);
  const existing = current?.data.operations.find(
    (operation) => operation.slot === slot,
  );
  if (existing?.state === "succeeded" || existing?.state === "failed")
    return { kind: "stored" } as const;
  if (existing?.state === "issued" || existing?.state === "unknown")
    return { kind: "uncertain" } as const;
  const prepared = await repository.prepareOperation(
    runId,
    slot,
    {
      inputHash: await sha256Hex(JSON.stringify(input)),
      queryText: input.queryText ?? null,
      targetUrl: input.targetUrl ?? null,
    },
    Date.now(),
  );
  if (prepared.kind !== "prepared") return { kind: prepared.kind } as const;
  return repository.issueOperation(runId, slot, Date.now(), configurationHash);
}
