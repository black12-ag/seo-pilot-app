import { CompetitorResearchRepository as repository } from "../repositories/CompetitorResearchRepository";
import { extractPublicSource } from "@/server/features/content/services/contentSourceExtraction";
import { ProjectRepository } from "@/server/features/projects/repositories/ProjectRepository";
import { fetchLiveSerp } from "@/server/lib/dataforseo/serp";
import { truncateToBytes } from "@/server/lib/audit/html-response";
import { classifyCompetitorCandidates } from "./competitorModel";
import { competitorExecutionConfiguration } from "./competitorResearchAccess";
import {
  currentCompetitorAuthority as authority,
  competitorDeadlineSignal as signal,
  issueCompetitorOperation as issue,
  type CompetitorOperationSlot as Slot,
} from "./competitorResearchAccess";
import { DataforseoChargedTaskError } from "@/server/lib/dataforseo/envelope";

type Internal = Awaited<ReturnType<typeof repository.getRun>>;
const SEARCH_SLOTS = ["search_0", "search_1"] as const;
const PAGE_SLOTS = ["page_0", "page_1", "page_2", "page_3", "page_4"] as const;

async function failed(
  runId: string,
  slot: Slot,
  token: string,
  reason:
    | "provider_unavailable"
    | "website_unreadable"
    | "invalid_model_output",
  error: unknown,
) {
  const charged =
    error instanceof DataforseoChargedTaskError ? error.billing : null;
  const outcome = charged ? "failed" : "unknown";
  await repository.recordOperationFailure(
    runId,
    slot,
    token,
    {
      outcome,
      reason: charged ? reason : "operation_outcome_unknown",
      billing: charged
        ? {
            costUsd: charged.costUsd,
            provider: "dataforseo",
            providerTaskId: null,
          }
        : null,
    },
    Date.now(),
  );
  return outcome;
}

type OperationOutcome = {
  outcome:
    | "complete"
    | "partial"
    | "unavailable"
    | "failed"
    | "blocked"
    | "unknown";
  reason:
    | "deadline"
    | "operation_outcome_unknown"
    | "provider_unavailable"
    | "website_unreadable"
    | "invalid_model_output"
    | "evidence_rejected"
    | "sponsor_changed"
    | null;
};
function terminal(
  _runId: string,
  outcome: OperationOutcome["outcome"],
  reason: OperationOutcome["reason"],
): OperationOutcome {
  return { outcome, reason };
}

function queryTerms(keywords: string[], brand: string, domain: string) {
  const terms = keywords
    .map((keyword) => keyword.replace(/\s+/gu, " ").trim())
    .filter(Boolean);
  if (!terms.length) terms.push(brand === "Default" ? domain : brand);
  return [
    ...new Set(terms.map((term) => `${term} alternatives`.slice(0, 200))),
  ].slice(0, 2);
}

async function ensureOwnPage(
  run: Internal["run"],
  domain: string,
  configHash: string,
) {
  const runId = run.id;
  const slot = "own_page" as const;
  const url = `https://${domain}/`;
  const issued = await issue(runId, slot, { targetUrl: url }, configHash);
  if (issued.kind === "uncertain")
    return terminal(runId, "unknown", "operation_outcome_unknown");
  if (issued.kind === "blocked" || issued.kind === "conflict")
    return terminal(runId, "blocked", "sponsor_changed");
  if (typeof issued === "object" && issued.kind === "issued") {
    try {
      const extraction = await extractPublicSource({
        requestedUrl: url,
        signal: signal(run.deadlineAtMs, 10_000),
      });
      const receipt = await repository.recordPage(
        runId,
        slot,
        issued.issueToken,
        extraction,
        Date.now(),
      );
      if (receipt.kind !== "stored")
        return terminal(runId, "unknown", "operation_outcome_unknown");
    } catch (error) {
      await failed(runId, slot, issued.issueToken, "website_unreadable", error);
      return terminal(runId, "unknown", "operation_outcome_unknown");
    }
  }
  return null;
}

async function finishClassification(input: {
  run: Internal["run"];
  domain: string;
  summary: string;
  data: Internal;
  configHash: string;
  partial: boolean;
  knownSearch: number;
  queryCount: number;
}) {
  const {
    run,
    domain,
    summary,
    data,
    configHash,
    partial,
    knownSearch,
    queryCount,
  } = input;
  const runId = run.id;
  const usable = data.candidates.filter(
    (candidate) =>
      candidate.sourceUrl &&
      candidate.sourceExcerpt &&
      candidate.sourceHash &&
      candidate.sourceCapturedAtMs !== null &&
      candidate.classification === "pending",
  );
  if (!usable.length)
    return terminal(
      runId,
      knownSearch === queryCount && !partial ? "complete" : "unavailable",
      knownSearch === queryCount && !partial ? null : "evidence_rejected",
    );
  const operation = data.operations.find((row) => row.slot === "classify");
  if (!operation) return terminal(runId, "failed", "invalid_model_output");
  const request = {
    v: 1 as const,
    operation: "classify_competitors" as const,
    requestId: operation.id,
    runId,
    deadlineAtMs: run.deadlineAtMs,
    business: {
      domain,
      summary: truncateToBytes(summary, 6000),
      locationCode: run.locationCode,
      languageCode: run.languageCode,
    },
    candidates: usable.map((candidate) => ({
      id: candidate.id,
      domain: candidate.domain,
      evidence: {
        url: candidate.sourceUrl!,
        excerpt: candidate.sourceExcerpt!,
        textHash: candidate.sourceHash!,
        capturedAtMs: candidate.sourceCapturedAtMs!,
      },
    })),
  };
  if (new TextEncoder().encode(JSON.stringify(request)).byteLength > 32768)
    return terminal(runId, "failed", "invalid_model_output");
  const issued = await issue(runId, "classify", {}, configHash);
  if (issued.kind === "uncertain")
    return terminal(runId, "unknown", "operation_outcome_unknown");
  if (issued.kind === "blocked" || issued.kind === "conflict")
    return terminal(runId, "blocked", "sponsor_changed");
  if (issued.kind === "stored")
    return terminal(runId, "unknown", "operation_outcome_unknown");
  if (typeof issued === "object" && issued.kind === "issued") {
    if (!(await authority(runId)))
      return terminal(runId, "unknown", "sponsor_changed");
    try {
      const response = await classifyCompetitorCandidates(request, {
        signal: signal(run.deadlineAtMs, 60_000),
      });
      if (response.status !== "succeeded")
        return terminal(runId, "unknown", "operation_outcome_unknown");
      const receipt = await repository.recordClassification(
        runId,
        issued.issueToken,
        response,
        Date.now(),
      );
      if (receipt.kind !== "stored")
        return terminal(runId, "unknown", "operation_outcome_unknown");
    } catch {
      await repository.recordOperationFailure(
        runId,
        "classify",
        issued.issueToken,
        {
          outcome: "unknown",
          reason: "operation_outcome_unknown",
          billing: null,
        },
        Date.now(),
      );
      return terminal(runId, "unknown", "operation_outcome_unknown");
    }
  }
  return terminal(
    runId,
    partial ? "partial" : "complete",
    partial ? "evidence_rejected" : null,
  );
}

async function runSearches(
  run: Internal["run"],
  queries: string[],
  configHash: string,
  initialData: Internal,
) {
  const runId = run.id;
  let data = initialData;
  let partial = false;
  let knownSearch = 0;
  for (const [index, queryText] of queries.entries()) {
    const slot = SEARCH_SLOTS[index];
    if (!slot) break;
    const issued = await issue(runId, slot, { queryText }, configHash);
    if (issued.kind === "uncertain")
      return terminal(runId, "unknown", "operation_outcome_unknown");
    if (issued.kind === "blocked" || issued.kind === "conflict")
      return terminal(runId, "blocked", "sponsor_changed");
    if (typeof issued === "object" && issued.kind === "issued") {
      const live = await authority(runId);
      if (!live) return terminal(runId, "unknown", "sponsor_changed");
      try {
        const result = await fetchLiveSerp(
          {
            keyword: queryText,
            locationCode: run.locationCode,
            languageCode: run.languageCode,
            depth: 10,
          },
          {
            signal: signal(run.deadlineAtMs, 60_000),
            maxServerErrorRetries: 0,
          },
        );
        const receipt = await repository.recordSearch(
          runId,
          slot,
          issued.issueToken,
          { billing: result.billing, organic: result.data },
          Date.now(),
        );
        if (receipt.kind !== "stored")
          return terminal(runId, "unknown", "operation_outcome_unknown");
      } catch (error) {
        const outcome = await failed(
          runId,
          slot,
          issued.issueToken,
          "provider_unavailable",
          error,
        );
        if (outcome === "unknown")
          return terminal(runId, "unknown", "operation_outcome_unknown");
        partial = true;
      }
    }
    data = (await authority(runId))?.data ?? data;
    if (
      data.operations.some(
        (operation) =>
          operation.slot === slot && operation.state === "succeeded",
      )
    )
      knownSearch++;
    else partial = true;
  }
  data = (await authority(runId))?.data ?? data;
  return { data, partial, knownSearch };
}

export async function runCompetitorOperations(
  runId: string,
): Promise<OperationOutcome | null> {
  const current = await authority(runId);
  if (!current) return null;
  const { run, scope } = current;
  if (
    run.origin !== "explicit" ||
    run.state === "finished" ||
    run.redactedAtMs !== null
  )
    return null;
  if (Date.now() >= run.deadlineAtMs)
    return terminal(runId, "unknown", "deadline");
  const snapshot = await repository.getSnapshot(scope.actor, run.projectId);
  if (
    snapshot.scope.memberId !== scope.memberId ||
    snapshot.snapshot.contextHash !== run.contextHash
  )
    return terminal(runId, "blocked", "sponsor_changed");
  const capability = await competitorExecutionConfiguration();
  if (
    !capability.search ||
    !capability.modelConfigured ||
    capability.modelConfigurationHash !== run.modelConfigurationHash
  )
    return terminal(runId, "blocked", "provider_unavailable");
  if (!run.domain) return terminal(runId, "blocked", "website_unreadable");
  let data: Internal = current.data;
  let summary = run.businessSummary;
  const configHash = capability.modelConfigurationHash;
  if (!summary) {
    const stopped = await ensureOwnPage(run, run.domain, configHash);
    if (stopped) return stopped;
    summary = (await authority(runId))?.run.businessSummary ?? "";
    if (!summary) return terminal(runId, "unavailable", "website_unreadable");
  }
  const project = await ProjectRepository.getProjectForOrganization(
    run.projectId,
    run.organizationId,
  );
  if (!project) return terminal(runId, "blocked", "sponsor_changed");
  const queries = queryTerms(snapshot.keywords, project.name, run.domain);
  const searchResult = await runSearches(run, queries, configHash, data);
  if ("outcome" in searchResult) return searchResult;
  data = searchResult.data;
  let partial = searchResult.partial;
  const knownSearch = searchResult.knownSearch;
  for (const candidate of data.candidates.slice(0, 5)) {
    const slot = PAGE_SLOTS[candidate.rankOrder];
    if (!slot || !candidate.requestedUrl) continue;
    const issued = await issue(
      runId,
      slot,
      { targetUrl: candidate.requestedUrl },
      configHash,
    );
    if (issued.kind === "uncertain")
      return terminal(runId, "unknown", "operation_outcome_unknown");
    if (issued.kind === "blocked" || issued.kind === "conflict")
      return terminal(runId, "blocked", "sponsor_changed");
    if (typeof issued === "object" && issued.kind === "issued") {
      try {
        const extraction = await extractPublicSource({
          requestedUrl: candidate.requestedUrl,
          signal: signal(run.deadlineAtMs, 10_000),
        });
        const receipt = await repository.recordPage(
          runId,
          slot,
          issued.issueToken,
          extraction,
          Date.now(),
        );
        if (receipt.kind !== "stored")
          return terminal(runId, "unknown", "operation_outcome_unknown");
        if (!["usable", "partial"].includes(extraction.extractionStatus))
          partial = true;
      } catch (error) {
        await failed(
          runId,
          slot,
          issued.issueToken,
          "website_unreadable",
          error,
        );
        return terminal(runId, "unknown", "operation_outcome_unknown");
      }
    }
  }
  data = (await authority(runId))?.data ?? data;
  partial ||= data.candidates.some(
    (candidate) => !candidate.sourceUrl || Boolean(candidate.partialEvidence),
  );
  return finishClassification({
    run,
    domain: run.domain,
    summary,
    data,
    configHash,
    partial,
    knownSearch,
    queryCount: queries.length,
  });
}
