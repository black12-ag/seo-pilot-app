import { z } from "zod";
import { normalizeBacklinksTarget } from "@/server/lib/dataforseoBacklinksTarget";
import { AppError } from "@/server/lib/errors";
import { hasDataforseoAccess } from "@/server/lib/provider-access";
import {
  checkUsageCreditsDepleted,
  type BillingCustomerContext,
} from "@/server/billing/subscription";
import {
  isHostedServerAuthMode,
  usesBetterAuthServer,
} from "@/server/lib/runtime-env";
import { CompetitorResearchRepository } from "@/server/features/competitor-research/repositories/CompetitorResearchRepository";
import { WebsiteResearchAttemptRepository as attempts } from "../repositories/WebsiteResearchAttemptRepository";
import {
  researchProjectWebsiteSchema,
  websiteResearchSchema,
} from "@/types/schemas/projectWebsite";
import type { CompetitorResearchActor } from "@/types/schemas/competitorResearch";
import { executeWebsiteResearchAttempt } from "./websiteResearchAttemptExecution";
import { withoutResearchReferences } from "./websiteResearchEvidence";
import { inspectLegacySetupBeforePaidStart } from "./legacySetupGate";

const startSchema = researchProjectWebsiteSchema.extend({
  requestId: z.string().uuid(),
  confirmedPaidWork: z.literal(true),
});
type Start = z.infer<typeof startSchema>;
type Options = { actor: CompetitorResearchActor; runSeededTracking?: boolean };
type Scope = Awaited<
  ReturnType<typeof CompetitorResearchRepository.getSnapshot>
>["scope"];

type AttemptRow = Awaited<ReturnType<typeof attempts.get>>;

/** Ends the attempt first, so a stale read can't touch a run that has moved on. */
async function endAttempt(
  scope: Scope,
  row: AttemptRow,
  reason: string,
  nowMs: number,
) {
  const ended = await attempts.finish(
    row.id,
    row.state === "admitted"
      ? { admissionToken: row.admissionToken }
      : { executionToken: row.executionToken! },
    row.state === "admitted" ? "failed" : "unknown",
    reason,
    nowMs,
  );
  if (ended.kind !== "finished") return false;
  const run = await CompetitorResearchRepository.getSetupRunByRequest(
    scope,
    row.projectId,
    row.id,
  );
  if (
    run &&
    ["queued", "running"].includes(run.state) &&
    run.redactedAtMs === null &&
    run.reason !== "restored" &&
    run.sponsorUserId === row.sponsorUserId &&
    run.sponsorMemberId === row.sponsorMemberId &&
    run.sponsorRole === row.sponsorRole &&
    run.requestHash === row.requestHash &&
    run.contextHash === row.contextHash
  )
    await CompetitorResearchRepository.finish(
      run.id,
      row.state === "running" ? "unknown" : "blocked",
      reason,
      nowMs,
    );
  return true;
}

async function releaseInvalid(scope: Scope, row: AttemptRow) {
  if (!["admitted", "running"].includes(row.state)) return;
  const nowMs = Date.now();
  if (await attempts.getAuthority(row.id, nowMs)) return;
  await endAttempt(
    scope,
    row,
    nowMs >= row.deadlineAtMs ? "deadline" : "context_changed",
    nowMs,
  );
}

/** A dead sponsor or executor can't hold the project past its deadline. */
async function releaseExpired(scope: Scope, projectId: string) {
  const nowMs = Date.now();
  const active = await attempts.getActive(projectId);
  if (!active || nowMs < active.deadlineAtMs) return false;
  return endAttempt(scope, active, "deadline", nowMs);
}

async function view(scope: Scope, projectId: string, id: string) {
  let row = await attempts.get(scope, projectId, id);
  await releaseInvalid(scope, row);
  row = await attempts.get(scope, projectId, id);
  if (row.redactedAtMs !== null)
    return {
      attemptId: id,
      status: "unavailable" as const,
      reason: "privacy_erased" as const,
      review: null,
    };
  let review = row.reviewSnapshotJson
    ? websiteResearchSchema.parse(JSON.parse(row.reviewSnapshotJson))
    : null;
  if (review) {
    review = {
      ...withoutResearchReferences(review),
      websiteResearchAttemptId: id,
    };
    if (row.competitorRunId) {
      const result = await CompetitorResearchRepository.getRun(
        scope,
        projectId,
        row.competitorRunId,
      );
      if (
        result.run.state === "finished" &&
        result.run.redactedAtMs === null &&
        result.run.reason !== "restored"
      ) {
        review.competitorResearchRunId = row.competitorRunId;
        review.competitorResearchContextVersion = row.contextVersion;
        review.competitors = review.competitors.map((item) => {
          const matched = result.candidates.find(
            (candidate) =>
              candidate.classification === "verified" &&
              candidate.domain === item.domain &&
              candidate.sourceUrl === item.sourceUrl &&
              candidate.sourceExcerpt &&
              candidate.sourceHash &&
              candidate.sourceCapturedAtMs !== null,
          );
          return matched ? { ...item, researchCandidateId: matched.id } : item;
        });
      }
    }
  }
  // Re-read after joining source evidence so a concurrent erasure cannot emit it.
  const after = await attempts.get(scope, projectId, id);
  if (after.redactedAtMs !== null)
    return {
      attemptId: id,
      status: "unavailable" as const,
      reason: "privacy_erased" as const,
      review: null,
    };
  return {
    attemptId: id,
    status: row.state,
    review,
    failure:
      row.state === "failed" || row.state === "unknown" ? row.reason : null,
  };
}

async function scopeFor(actor: CompetitorResearchActor, projectId: string) {
  const current = await CompetitorResearchRepository.getSnapshot(
    actor,
    projectId,
  );
  if (!current.scope.requireMembership || !current.scope.memberId)
    throw new AppError("FORBIDDEN");
  return current;
}

async function readOriginal(
  scope: Scope,
  input: Start,
  seeded: boolean,
  mode: "direct" | "ai_setup",
) {
  const existing = await attempts.lookupExistingForStart(
    scope,
    input.projectId,
    input.requestId,
  );
  if (existing.kind === "missing") return null;
  if (existing.kind === "privacy_erased")
    return {
      attemptId: input.requestId,
      status: "unavailable" as const,
      reason: "privacy_erased" as const,
      review: null,
    };
  if (existing.kind === "restored") throw new AppError("CONFLICT");
  const row = existing.row;
  const requested = input.website.trim();
  const domain = normalizeBacklinksTarget(requested, {
    scope: "domain",
  }).apiTarget;
  if (
    row.mode !== mode ||
    row.surface !== scope.actor.surface ||
    row.requestedWebsite !== requested ||
    row.requestedDomain !== domain ||
    Boolean(row.runSeededTracking) !== seeded ||
    row.sponsorUserId !== scope.actor.userId ||
    row.sponsorMemberId !== scope.memberId ||
    row.sponsorRole !== scope.actor.role
  )
    throw new AppError("CONFLICT");
  return view(scope, input.projectId, input.requestId);
}

async function start(
  raw: Start,
  customer: BillingCustomerContext,
  options: Options,
  mode: "direct" | "ai_setup",
) {
  const input = startSchema.parse(raw);
  if (!(await usesBetterAuthServer())) throw new AppError("FORBIDDEN");
  if (
    options.actor.organizationId !== customer.organizationId ||
    options.actor.userId !== customer.userId
  )
    throw new AppError("FORBIDDEN");
  const seeded = options.runSeededTracking ?? false;
  const { scope, snapshot, savedDomains } = await scopeFor(
    options.actor,
    input.projectId,
  );
  const original = await readOriginal(scope, input, seeded, mode);
  if (original) return original;
  const legacy = await inspectLegacySetupBeforePaidStart(
    scope,
    input.projectId,
  );
  if (legacy.kind === "unavailable")
    throw new AppError(
      "UPSTREAM_UNAVAILABLE",
      "Legacy setup status needs reconciliation before new paid work.",
    );
  if (legacy.kind === "running")
    return { attemptId: null, status: "legacy_running" as const, review: null };
  if (legacy.kind === "review")
    return {
      attemptId: null,
      status: "legacy_review" as const,
      review: withoutResearchReferences(legacy.review),
    };
  // Finding competitors needs live search, and research fails without it. Say
  // so now, before a model call or a page read is spent on a run that can't end.
  if (!savedDomains.length && !(await hasDataforseoAccess()))
    throw new AppError("DATAFORSEO_AUTH_FAILED");
  if (
    (await isHostedServerAuthMode()) &&
    (await checkUsageCreditsDepleted(customer)).depleted
  )
    throw new AppError("INSUFFICIENT_CREDITS");
  const admit = () =>
    attempts.admit(scope, {
      id: input.requestId,
      projectId: input.projectId,
      mode,
      requestedWebsite: input.website,
      runSeededTracking: seeded,
      snapshot,
      nowMs: Date.now(),
    });
  let admitted = await admit();
  if (
    admitted.kind === "busy" &&
    (await releaseExpired(scope, input.projectId))
  )
    admitted = await admit();
  if (admitted.kind === "privacy_erased")
    return {
      attemptId: input.requestId,
      status: "unavailable" as const,
      reason: "privacy_erased" as const,
      review: null,
    };
  if (admitted.kind === "replayed") {
    const receipt = await readOriginal(scope, input, seeded, mode);
    if (!receipt) throw new AppError("CONFLICT");
    return receipt;
  }
  if (admitted.kind === "busy")
    throw new AppError("CONFLICT", "website_research_in_progress");
  if (admitted.kind !== "created") throw new AppError("CONFLICT");
  if (mode === "direct")
    await executeWebsiteResearchAttempt(
      input.requestId,
      admitted.admissionToken,
    );
  const result = await view(scope, input.projectId, input.requestId);
  // A concurrent copy of this request gets the same receipt from "replayed"
  // above, so only the caller that created the row launches it.
  return mode === "ai_setup"
    ? { ...result, ownsLaunch: true as const }
    : result;
}

async function get(
  actor: CompetitorResearchActor,
  projectId: string,
  id: string,
) {
  const { scope } = await scopeFor(actor, projectId);
  return view(scope, projectId, id);
}

async function getLatestAi(actor: CompetitorResearchActor, projectId: string) {
  const { scope } = await scopeFor(actor, projectId);
  const row = await attempts.getLatestAi(scope, projectId);
  return row ? view(scope, projectId, row.id) : null;
}

export const WebsiteResearchAttemptService = {
  startDirect: (
    input: Start,
    customer: BillingCustomerContext,
    options: Options,
  ) => start(input, customer, options, "direct"),
  admitAi: (input: Start, customer: BillingCustomerContext, options: Options) =>
    start(input, customer, options, "ai_setup"),
  get,
  getLatestAi,
};
