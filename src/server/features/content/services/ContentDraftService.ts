import { waitUntil } from "cloudflare:workers";
import { billResearchSpend } from "@/server/billing/researchSpend";
import { checkUsageCreditsDepleted } from "@/server/billing/subscription";
import { ContentDraftRepository as drafts } from "@/server/features/content/repositories/contentDraftWrites";
import { ContentRepository } from "@/server/features/content/repositories/ContentRepository";
import { INCLUDED_IN_SUBSCRIPTION_LABEL } from "@/server/lib/aiEngine/billing";
import { sha256Hex } from "@/server/lib/audit/ids";
import { AppError, describeError } from "@/server/lib/errors";
import { resolveAiAccess, type AiAccess } from "@/server/lib/openrouter";
import { isHostedServerAuthMode } from "@/server/lib/runtime-env";
import {
  contentDraftRequestSchema,
  contentDraftSetupInputSchema,
  generateContentDraftInputSchema,
  type ContentDraftRequest,
  type GenerateContentDraftInput,
} from "@/types/schemas/contentDraft";
import type {
  ContentActor,
  SavedContentRevision,
} from "@/types/schemas/content";
import type { SavedContentSource } from "@/types/schemas/contentEvidence";
import { contentAccess } from "./contentAccess";
import { contentContextSnapshot } from "./contentContextSnapshot";
import { assembleContentDraft } from "./contentDraftAssembly";
import {
  buildContentDraftPrompt,
  callContentDraftModel,
  contentDraftLimits,
  CONTENT_DRAFT_PROMPT_VERSION,
} from "./contentDraftModel";
import { ContentService } from "./ContentService";
import { ContentSourceService } from "./ContentSourceService";

// The model limit plus time to save, after which a claim with no result is
// reported as unknown: it may have been charged, and it is never run again.
const DRAFT_WINDOW_MS = contentDraftLimits.timeoutMs + 60_000;

const FAILURES = [
  "model_failed",
  "no_supported_content",
  "head_changed",
  "context_changed",
  "save_failed",
] as const;
type DraftFailure = (typeof FAILURES)[number];
const failureFrom = (resultId: string) =>
  FAILURES.find((reason) => reason === resultId);
// Stored as the claim's result. A paid call that can't be metered isn't a plain
// failure: nobody knows what it cost, and it is never run again.
const COST_NOT_REPORTED = "cost_not_reported";
// Also stored as the claim's result. The request may have reached the model and
// no reply came back, so neither its outcome nor its cost is known.
const NO_RESPONSE = "no_response";

type ContentDraftResult =
  | { status: "none" }
  | { status: "running" }
  | {
      status: "unknown";
      reason?: typeof COST_NOT_REPORTED | typeof NO_RESPONSE;
    }
  | { status: "needs_setup" }
  | { status: "busy" }
  | {
      status: "blocked";
      reason: "head_changed" | "context_changed" | "archived" | "no_sources";
    }
  | { status: "failed"; reason: DraftFailure }
  | { status: "done"; revision: SavedContentRevision; replayed: boolean };

const claimId = (requestId: string) => `draft:${requestId}`;
const revisionMutationId = (requestId: string) => `draft-revision:${requestId}`;
const hashOf = (input: ContentDraftRequest) =>
  sha256Hex(
    JSON.stringify([
      input.projectId,
      input.contentId,
      input.requestId,
      input.expectedHeadVersion,
      input.expectedContextVersion,
    ]),
  );

async function readRequest(
  actor: ContentActor,
  input: ContentDraftRequest,
  requestHash: string,
): Promise<ContentDraftResult> {
  const claim = await drafts.getDraftClaim(
    actor.organizationId,
    input.projectId,
    claimId(input.requestId),
  );
  if (!claim) return { status: "none" };
  if (claim.kind !== drafts.DRAFT_KIND || claim.requestHash !== requestHash)
    throw new AppError("CONFLICT", "mutation_id_conflict");
  // The saved revision is the proof of success, even if the claim never closed.
  const saved = await ContentRepository.getMutation(
    actor.organizationId,
    input.projectId,
    revisionMutationId(input.requestId),
  );
  if (saved) {
    const revision = await ContentRepository.getRevisionById(
      actor.organizationId,
      input.projectId,
      saved.resultId,
    );
    if (!revision) throw new AppError("CONFLICT", "revision_unavailable");
    return { status: "done", revision, replayed: true };
  }
  if (claim.completed === 1) {
    if (claim.resultId === COST_NOT_REPORTED || claim.resultId === NO_RESPONSE)
      return { status: "unknown", reason: claim.resultId };
    const reason = failureFrom(claim.resultId);
    return reason ? { status: "failed", reason } : { status: "unknown" };
  }
  return Date.now() - claim.createdAtMs < DRAFT_WINDOW_MS
    ? { status: "running" }
    : { status: "unknown" };
}

function generationNote(
  modelId: string,
  sources: SavedContentSource[],
  costUsd: number | null,
  includedInSubscription: boolean,
) {
  const versions = sources
    .map((source) => `${source.id}@${source.textHash.slice(0, 12)}`)
    .join(", ");
  const cost = includedInSubscription
    ? INCLUDED_IN_SUBSCRIPTION_LABEL
    : costUsd === null
      ? "not reported"
      : `$${costUsd.toFixed(4)} USD`;
  return `Generated draft. Model: ${modelId}. Prompt: ${CONTENT_DRAFT_PROMPT_VERSION}. Source versions: ${versions}. Known cost: ${cost}.`;
}

async function runClaimed({
  actor,
  input,
  head,
  sources,
  snapshot,
  access,
  finish,
  userEmail,
}: {
  actor: ContentActor;
  input: ContentDraftRequest;
  head: SavedContentRevision;
  sources: SavedContentSource[];
  snapshot: Awaited<ReturnType<typeof contentContextSnapshot>>["snapshot"];
  access: AiAccess;
  finish: (resultId: string) => Promise<void>;
  userEmail: string;
}): Promise<ContentDraftResult> {
  const fail = async (reason: DraftFailure) => {
    await finish(reason);
    return { status: "failed" as const, reason };
  };
  const refs = new Map(sources.map((source, i) => [`S${i + 1}`, source]));
  const request = buildContentDraftPrompt({
    brief: head.brief,
    snapshot,
    sources: refs,
  });
  const called = await callContentDraftModel(access, request);
  // Billing an empty list would record this as settled and free.
  if (called.outcomeUnknown) {
    console.error("content.draft.no-response", {
      organizationId: actor.organizationId,
      projectId: input.projectId,
      requestId: input.requestId,
      modelId: called.modelId,
    });
    await finish(NO_RESPONSE);
    return { status: "unknown", reason: NO_RESPONSE };
  }
  // Credits can't be charged without a cost, so a hosted draft isn't handed
  // over for free. Where the install pays its own key there is nothing to meter
  // and the revision records that the cost was not reported.
  if (called.costMissing && (await isHostedServerAuthMode())) {
    console.error("content.draft.cost-not-reported", {
      organizationId: actor.organizationId,
      projectId: input.projectId,
      requestId: input.requestId,
      modelId: called.modelId,
    });
    await finish(COST_NOT_REPORTED);
    return { status: "unknown", reason: COST_NOT_REPORTED };
  }
  await billResearchSpend(
    {
      organizationId: actor.organizationId,
      projectId: input.projectId,
      userId: actor.userId,
      userEmail,
    },
    called.costUsd === null
      ? []
      : [
          {
            provider: "openrouter",
            creditFeature: "agent",
            operation: "content_draft_generation",
            costUsd: called.costUsd,
          },
        ],
  );
  if (!called.output) return fail("model_failed");
  const draft = assembleContentDraft(called.output, refs, head);
  if (!draft.markdown) return fail("no_supported_content");
  const titles = new Map(sources.map(({ id, title }) => [id, title]));
  const notes = [
    ...request.truncatedSourceIds.map(
      (id) => `Only part of this source was read: ${titles.get(id)}`,
    ),
    ...(request.contextTrimmed
      ? ["Project context was too long and was shortened for this draft."]
      : []),
  ];
  try {
    const saved = await ContentService.saveGeneratedRevision(
      actor,
      {
        projectId: input.projectId,
        contentId: input.contentId,
        mutationId: revisionMutationId(input.requestId),
        expectedHeadVersion: input.expectedHeadVersion,
        expectedContextVersion: input.expectedContextVersion,
        brief: head.brief,
        sourceIds: head.sourceIds,
        ...draft,
        omissions: [...notes, ...draft.omissions].slice(0, 100),
      },
      generationNote(
        called.modelId,
        sources,
        called.costUsd,
        called.includedInSubscription,
      ),
    );
    if (!saved.ok) return await fail("head_changed");
    await finish(saved.revision.id);
    return { status: "done", revision: saved.revision, replayed: false };
  } catch (error) {
    console.error("content.draft.save-failed", describeError(error));
    const changed =
      error instanceof AppError && error.message === "context_changed";
    return fail(changed ? "context_changed" : "save_failed");
  }
}

async function generate(
  actor: ContentActor,
  raw: GenerateContentDraftInput,
  userEmail: string,
): Promise<ContentDraftResult> {
  const { confirmedPaidWork: _confirmed, ...input } =
    generateContentDraftInputSchema.parse(raw);
  const permit = await contentAccess(actor, input.projectId);
  const requestHash = await hashOf(input);
  const previous = await readRequest(actor, input, requestHash);
  if (previous.status !== "none") return previous;
  const item = await ContentRepository.getItemStatus(
    actor.organizationId,
    input.projectId,
    input.contentId,
  );
  if (!item) throw new AppError("NOT_FOUND");
  if (item.archivedAtMs !== null)
    return { status: "blocked", reason: "archived" };
  const head = await ContentRepository.getRevision(
    actor.organizationId,
    input.projectId,
    input.contentId,
  );
  if (!head) throw new AppError("NOT_FOUND");
  if (head.version !== input.expectedHeadVersion)
    return { status: "blocked", reason: "head_changed" };
  const live = await contentContextSnapshot(
    actor.organizationId,
    input.projectId,
    head.brief.locale,
  );
  if (live.contextVersion !== input.expectedContextVersion)
    return { status: "blocked", reason: "context_changed" };
  const attached = await Promise.all(
    head.sourceIds.map((id) =>
      ContentSourceService.get(actor, input.projectId, id),
    ),
  );
  const sources = attached.filter(
    (source) =>
      source.sourceText.trim() &&
      source.attribution.trim() &&
      ["usable", "partial"].includes(source.extractionStatus),
  );
  if (!sources.length) return { status: "blocked", reason: "no_sources" };
  const access = await resolveAiAccess();
  if (!access) return { status: "needs_setup" };
  if (
    (await isHostedServerAuthMode()) &&
    (
      await checkUsageCreditsDepleted({
        organizationId: actor.organizationId,
        projectId: input.projectId,
        userId: actor.userId,
        userEmail,
      })
    ).depleted
  )
    throw new AppError("INSUFFICIENT_CREDITS");
  const nowMs = Date.now();
  const scope = {
    actor: permit.scope,
    membershipId: permit.membership?.id ?? null,
  };
  const { claimed } = await drafts.claimDraft(scope, {
    projectId: input.projectId,
    contentId: input.contentId,
    mutationId: claimId(input.requestId),
    requestHash,
    expectedHeadVersion: input.expectedHeadVersion,
    nowMs,
    liveAfterMs: nowMs - DRAFT_WINDOW_MS,
  });
  if (!claimed) {
    const raced = await readRequest(actor, input, requestHash);
    return raced.status === "none" ? { status: "busy" } : raced;
  }
  await contentAccess(actor, input.projectId);
  const finish = (resultId: string) =>
    drafts.finishDraft(scope, {
      projectId: input.projectId,
      mutationId: claimId(input.requestId),
      requestHash,
      resultId,
    });
  const work = runClaimed({
    actor,
    input,
    head,
    sources,
    snapshot: live.snapshot,
    access,
    finish,
    userEmail,
  });
  // A dropped connection shouldn't lose a call that is already paid for. The
  // caller reads the result back with the same request ID.
  waitUntil(work.catch(() => undefined));
  return work;
}

async function getRequest(actor: ContentActor, raw: ContentDraftRequest) {
  const input = contentDraftRequestSchema.parse(raw);
  await contentAccess(actor, input.projectId);
  const result = await readRequest(actor, input, await hashOf(input));
  await contentAccess(actor, input.projectId);
  return result;
}

async function getSetup(actor: ContentActor, raw: { projectId: string }) {
  const input = contentDraftSetupInputSchema.parse(raw);
  await contentAccess(actor, input.projectId);
  return {
    configured: Boolean(await resolveAiAccess()),
    usesCredits: await isHostedServerAuthMode(),
    maxOutputTokens: contentDraftLimits.maxOutputTokens,
  };
}

export const ContentDraftService = {
  generate,
  getRequest,
  getSetup,
} as const;
