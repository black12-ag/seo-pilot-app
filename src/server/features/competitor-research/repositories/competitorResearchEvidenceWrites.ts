import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { runBatch } from "@/db/runBatch";
import {
  projectCompetitorResearchCandidates as candidates,
  projectCompetitorResearchOperations as operations,
  projectCompetitorResearchRuns as runs,
} from "@/db/schema";
import { truncateToBytes } from "@/server/lib/audit/html-response";
import { sha256Hex } from "@/server/lib/audit/ids";
import { normalizeDomainInput } from "@/server/lib/domainUtils";
import type { DataforseoApiCallCost } from "@/server/lib/dataforseo/envelope";
import type { SerpLiveItem } from "@/server/lib/dataforseo/serp";
import {
  publicSourceExtractionSchema,
  type PublicSourceExtraction,
} from "@/types/schemas/contentSourceIntake";
import {
  competitorClassificationResponseSchema,
  type CompetitorClassificationResponse,
} from "@/shared/competitorWorkerContract";
import { currentAuthority, locks } from "./competitorResearchOperationWrites";

type Slot =
  | "own_page"
  | "search_0"
  | "search_1"
  | "page_0"
  | "page_1"
  | "page_2"
  | "page_3"
  | "page_4"
  | "classify";
async function find(runId: string, slot: Slot) {
  const [run] = await db.select().from(runs).where(eq(runs.id, runId)).limit(1);
  const [operation] = await db
    .select()
    .from(operations)
    .where(and(eq(operations.runId, runId), eq(operations.slot, slot)))
    .limit(1);
  return run && operation ? { run, operation } : null;
}
function live(
  run: typeof runs.$inferSelect,
  operation: typeof operations.$inferSelect,
  token: string,
  nowMs: number,
) {
  return sql`${currentAuthority(run, nowMs)} and exists (select 1 from project_competitor_research_operations o where o.id = ${operation.id} and o.run_id = ${run.id} and o.state = 'issued' and o.issue_token = ${token})`;
}
async function result(runId: string, slot: Slot, token: string) {
  const row = await find(runId, slot);
  return row?.run.redactedAtMs === null &&
    row.operation.issueToken === token &&
    row.operation.state === "succeeded"
    ? ({ kind: "stored" } as const)
    : ({ kind: "blocked" } as const);
}
function domainOf(url: string) {
  try {
    const u = new URL(url);
    if (
      !["http:", "https:"].includes(u.protocol) ||
      u.username ||
      u.password ||
      url.length > 2048
    )
      return null;
    return normalizeDomainInput(u.hostname, true);
  } catch {
    return null;
  }
}
function boundText(text: string, max: number) {
  let value = truncateToBytes(text, max);
  while (new TextEncoder().encode(value).byteLength > max)
    value = value.slice(0, -1);
  return value;
}

async function recordSearch(
  runId: string,
  slot: "search_0" | "search_1",
  token: string,
  input: { billing: DataforseoApiCallCost; organic: SerpLiveItem[] },
  nowMs: number,
) {
  const found = await find(runId, slot);
  if (
    !found ||
    !Number.isFinite(input.billing.costUsd) ||
    input.billing.costUsd < 0
  )
    return { kind: "blocked" } as const;
  const { run, operation } = found;
  const items = input.organic
    .slice(0, 10)
    .filter((item) => item.type === "organic" && !!item.url)
    .flatMap((item) => {
      const url = item.url;
      if (!url) return [];
      const domain = domainOf(url);
      return domain
        ? [
            {
              id: crypto.randomUUID(),
              operationId: crypto.randomUUID(),
              domain,
              url,
            },
          ]
        : [];
    });
  const guard = sql`${live(run, operation, token, nowMs)} ${slot === "search_1" ? sql`and exists (select 1 from project_competitor_research_operations first where first.run_id = ${runId} and first.slot = 'search_0' and first.state in ('succeeded','failed'))` : sql``}`;
  await runBatch((tx) => [
    ...locks(tx, run),
    ...items.flatMap((item) => [
      tx
        .insert(candidates)
        .select(
          sql`select ${item.id}, ${run.projectId}, ${runId}, ${item.domain}, (select count(*) from project_competitor_research_candidates c where c.run_id = ${runId}), ${slot}, ${item.url}, null, null, null, null, null, null, 0, 'pending', null, null, 0, null, null, null, null, null
        where ${guard} and ${item.domain} <> coalesce(${run.domain ? domainOf(`https://${run.domain}`) : null},'')
          and (select count(*) from project_competitor_research_candidates c where c.run_id = ${runId}) < 5
          and not exists (select 1 from project_competitors c where c.project_id = ${run.projectId} and c.domain = ${item.domain})`,
        )
        .onConflictDoNothing(),
      tx
        .insert(operations)
        .select(
          sql`select ${item.operationId}, ${run.projectId}, ${runId}, ('page_' || c.rank_order), 'page', 'prepared', null, null, null, null, ${item.id}, null, null, null, null, null, null, 'unknown', null, null, null from project_competitor_research_candidates c where c.id = ${item.id} and c.run_id = ${runId} and ${guard}`,
        )
        .onConflictDoNothing(),
    ]),
    tx
      .update(operations)
      .set({
        state: "succeeded",
        finishedAtMs: nowMs,
        provider: "dataforseo",
        usageBasis: "usd",
        costUsd: input.billing.costUsd,
      })
      .where(and(eq(operations.id, operation.id), guard)),
  ]);
  return result(runId, slot, token);
}

async function recordPage(
  runId: string,
  slot: "own_page" | "page_0" | "page_1" | "page_2" | "page_3" | "page_4",
  token: string,
  extraction: PublicSourceExtraction,
  nowMs: number,
) {
  const parsed = publicSourceExtractionSchema.safeParse(extraction);
  const found = await find(runId, slot);
  if (!parsed.success || !found) return { kind: "blocked" } as const;
  const { run, operation } = found;
  if (operation.targetUrl !== extraction.requestedUrl)
    return { kind: "blocked" } as const;
  const [candidate] = operation.candidateId
    ? await db
        .select()
        .from(candidates)
        .where(
          and(
            eq(candidates.id, operation.candidateId),
            eq(candidates.runId, runId),
            eq(candidates.projectId, run.projectId),
          ),
        )
        .limit(1)
    : [];
  const expected =
    slot === "own_page"
      ? run.domain
        ? domainOf(`https://${run.domain}`)
        : null
      : candidate?.domain;
  const usable =
    !!expected &&
    !!extraction.resolvedUrl &&
    domainOf(extraction.resolvedUrl) === expected &&
    ["usable", "partial"].includes(extraction.extractionStatus) &&
    extraction.sourceText.trim().length > 0 &&
    extraction.extractionMethod !== "public_fetch";
  const excerpt = usable ? boundText(extraction.sourceText, 2000) : null;
  const hash = excerpt ? await sha256Hex(excerpt) : null;
  const guard = live(run, operation, token, nowMs);
  await runBatch((tx) => [
    ...locks(tx, run),
    ...(slot === "own_page"
      ? [
          tx
            .update(runs)
            .set({
              ownSourceUrl: usable ? extraction.resolvedUrl : null,
              ownSourceHash: hash,
              ownSourceCapturedAtMs: usable ? extraction.capturedAtMs : null,
              ...(usable && !run.businessSummary
                ? { businessSummary: boundText(extraction.sourceText, 6000) }
                : {}),
            })
            .where(and(eq(runs.id, runId), guard)),
        ]
      : candidate
        ? [
            tx
              .update(candidates)
              .set({
                sourceUrl: usable ? extraction.resolvedUrl : null,
                sourceExcerpt: excerpt,
                sourceHash: hash,
                sourceCapturedAtMs: usable ? extraction.capturedAtMs : null,
                extractionMethod:
                  usable && extraction.extractionMethod !== "public_fetch"
                    ? extraction.extractionMethod
                    : null,
                extractionReason: extraction.extractionReason,
                partialEvidence:
                  extraction.extractionStatus === "partial" ? 1 : 0,
                classification: usable ? "pending" : "unreadable",
                name: usable
                  ? extraction.title.trim().slice(0, 120) || candidate.domain
                  : null,
              })
              .where(
                and(
                  eq(candidates.id, candidate.id),
                  eq(candidates.runId, runId),
                  eq(candidates.projectId, run.projectId),
                  guard,
                ),
              ),
          ]
        : []),
    tx
      .update(operations)
      .set({
        state: "succeeded",
        finishedAtMs: nowMs,
        provider: "public_fetch",
        reason: usable ? null : "evidence_rejected",
      })
      .where(
        and(
          eq(operations.id, operation.id),
          guard,
          slot === "own_page"
            ? sql`true`
            : sql`exists (select 1 from project_competitor_research_candidates c where c.id = ${operation.candidateId} and c.run_id = ${runId} and c.project_id = ${run.projectId})`,
        ),
      ),
  ]);
  return result(runId, slot, token);
}

function hasEvidence(c: typeof candidates.$inferSelect) {
  return (
    !!c.sourceUrl &&
    !!c.sourceExcerpt &&
    !!c.sourceHash &&
    c.sourceCapturedAtMs !== null
  );
}

async function classificationReceipt(
  run: typeof runs.$inferSelect,
  operationId: string,
  token: string,
  response: Extract<CompetitorClassificationResponse, { status: "succeeded" }>,
  nowMs: number,
) {
  const rows = await db
    .select()
    .from(candidates)
    .where(
      and(
        eq(candidates.projectId, run.projectId),
        eq(candidates.runId, run.id),
      ),
    );
  if (
    rows.some(
      (c) =>
        ["verified", "not_competitor"].includes(c.classification) &&
        !hasEvidence(c),
    )
  )
    return { kind: "blocked" } as const;
  const usable = rows.filter(hasEvidence);
  if (
    response.output.selections.some(
      (s) => !usable.some((c) => c.id === s.candidateId),
    )
  )
    return { kind: "blocked" } as const;
  if (
    usable.some((c) => {
      const selected = response.output.selections.find(
        (s) => s.candidateId === c.id,
      );
      return selected
        ? c.classification !== "verified" || c.rationale !== selected.reason
        : c.classification !== "not_competitor" || c.rationale !== null;
    })
  )
    return { kind: "blocked" } as const;
  const [receipt] = await db
    .select()
    .from(operations)
    .where(
      and(
        eq(operations.id, operationId),
        eq(operations.runId, run.id),
        eq(operations.state, "succeeded"),
        eq(operations.issueToken, token),
        currentAuthority(run, nowMs),
      ),
    )
    .limit(1);
  return receipt &&
    receipt.backendModelId === response.usage.modelId &&
    receipt.usageBasis === response.usage.basis &&
    receipt.costUsd === response.usage.costUsd &&
    receipt.inputTokens === response.usage.inputTokens &&
    receipt.outputTokens === response.usage.outputTokens
    ? ({ kind: "stored" } as const)
    : ({ kind: "blocked" } as const);
}

async function recordClassification(
  runId: string,
  token: string,
  response: CompetitorClassificationResponse,
  nowMs: number,
) {
  const parsed = competitorClassificationResponseSchema.safeParse(response);
  const found = await find(runId, "classify");
  if (!parsed.success || !found || response.status !== "succeeded")
    return { kind: "blocked" } as const;
  const { run, operation } = found;
  if (
    response.requestId !== operation.id ||
    response.usage.backendId !== run.modelBackendId ||
    new TextEncoder().encode(JSON.stringify(response.output)).byteLength > 16384
  )
    return { kind: "blocked" } as const;
  if (operation.state === "succeeded")
    return classificationReceipt(run, operation.id, token, response, nowMs);
  const rows = await db
    .select()
    .from(candidates)
    .where(
      and(eq(candidates.projectId, run.projectId), eq(candidates.runId, runId)),
    );
  const usable = rows.filter(
    (c) => c.classification === "pending" && hasEvidence(c),
  );
  if (
    response.output.selections.some(
      (selection) => !usable.some((c) => c.id === selection.candidateId),
    )
  )
    return { kind: "blocked" } as const;
  const guard = live(run, operation, token, nowMs);
  await runBatch((tx) => [
    ...locks(tx, run),
    ...usable.map((c) => {
      const selection = response.output.selections.find(
        (s) => s.candidateId === c.id,
      );
      return tx
        .update(candidates)
        .set({
          classification: selection ? "verified" : "not_competitor",
          rationale: selection?.reason ?? null,
        })
        .where(
          and(
            eq(candidates.id, c.id),
            eq(candidates.runId, runId),
            eq(candidates.projectId, run.projectId),
            eq(candidates.classification, "pending"),
            guard,
          ),
        );
    }),
    tx
      .update(operations)
      .set({
        state: "succeeded",
        finishedAtMs: nowMs,
        backendModelId: response.usage.modelId,
        usageBasis: response.usage.basis,
        costUsd: response.usage.costUsd,
        inputTokens: response.usage.inputTokens,
        outputTokens: response.usage.outputTokens,
      })
      .where(and(eq(operations.id, operation.id), guard)),
  ]);
  return classificationReceipt(run, operation.id, token, response, nowMs);
}
export { recordSearch, recordPage, recordClassification };
