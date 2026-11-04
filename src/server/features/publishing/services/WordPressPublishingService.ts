import { ContentReviewService } from "@/server/features/content/services/ContentReviewService";
import { ContentService } from "@/server/features/content/services/ContentService";
import { ContentRepository } from "@/server/features/content/repositories/ContentRepository";
import { AppError } from "@/server/lib/errors";
import type { ContentActor } from "@/types/schemas/content";
import {
  publishDraftInputSchema,
  publishPreviewInputSchema,
  publishRecordInputSchema,
  type PublishDraftInput,
  type PublishingRefusal,
  type PublishOutcome,
  type PublishPreview,
  type PublishPreviewInput,
  type PublishRecordInput,
} from "@/types/schemas/publishing";
import {
  PublishingRepository,
  type HeldApproval,
  type PublishRecordRow,
} from "../repositories/PublishingRepository";
import { openConnection, publishingAccess } from "./publishingAccess";
import { publishRecordView } from "./publishRecordView";
import {
  createWordPressDraft,
  findWordPressPostsByMarker,
  getWordPressPost,
  latestWordPressRevisionId,
  postIsGone,
  trashWordPressPost,
  type WordPressSite,
} from "./wordpressClient";
import {
  buildWordPressDraft,
  inertTitle,
  recordErased,
  unchangedSinceLastWrite,
  wordPressIdempotencyKey,
  wordPressMarker,
} from "./wordpressDraft";
import { settleFromPost } from "./wordpressReadback";
import {
  latest,
  loadRecord,
  recorded,
  reconcileWordPressRecord,
  refused,
  rejectionRefusal,
} from "./wordpressReconcile";

const blocked = (reason: PublishingRefusal) => ({
  status: "blocked" as const,
  reason,
});

async function eligibleDraft(
  actor: ContentActor,
  input: {
    projectId: string;
    contentId: string;
    revisionId: string;
    expectedHeadVersion: number;
  },
  origin: string,
): Promise<
  | { refused: PublishingRefusal }
  | {
      draft: Awaited<ReturnType<typeof buildWordPressDraft>>;
      idempotencyKey: string;
      approval: HeldApproval;
    }
> {
  const eligibility = await ContentReviewService.currentEligibility(
    actor,
    input,
  );
  if (!eligibility.eligible) return { refused: eligibility.reason };
  const idempotencyKey = await wordPressIdempotencyKey({
    projectId: input.projectId,
    contentId: input.contentId,
    revisionId: input.revisionId,
    origin,
  });
  const draft = await buildWordPressDraft(
    {
      title: eligibility.value.metadata.title,
      slug: eligibility.value.metadata.slug,
      markdown: eligibility.value.markdown,
    },
    idempotencyKey,
  );
  if (!draft.title) return { refused: "title_missing" };
  return {
    draft,
    idempotencyKey,
    approval: {
      requestId: eligibility.value.review.requestId,
      requestVersion: eligibility.value.review.version,
      headVersion: input.expectedHeadVersion,
    },
  };
}

async function preview(
  actor: ContentActor,
  raw: PublishPreviewInput,
): Promise<PublishPreview> {
  const input = publishPreviewInputSchema.parse(raw);
  await publishingAccess(actor, input.projectId);
  const connection = await PublishingRepository.getConnection(
    actor.organizationId,
    input.projectId,
  );
  if (!connection) return blocked("not_connected");
  const item = await ContentRepository.getItemStatus(
    actor.organizationId,
    input.projectId,
    input.contentId,
  );
  if (!item) throw new AppError("NOT_FOUND");
  const head = await ContentService.listRevisions(actor, {
    projectId: input.projectId,
    contentId: input.contentId,
    limit: 1,
  });
  const revisionId = head.items[0]?.id;
  if (!revisionId) return blocked("revision_unavailable");
  const built = await eligibleDraft(
    actor,
    {
      projectId: input.projectId,
      contentId: input.contentId,
      revisionId,
      expectedHeadVersion: item.headVersion,
    },
    connection.origin,
  );
  if ("refused" in built) return blocked(built.refused);
  const record = await PublishingRepository.getRecordByKey(
    actor.organizationId,
    input.projectId,
    built.idempotencyKey,
  );
  return {
    status: "ready",
    origin: connection.origin,
    title: built.draft.title,
    slug: built.draft.slug,
    html: built.draft.html,
    contentHash: built.draft.contentHash,
    revisionId,
    headVersion: item.headVersion,
    record: record ? publishRecordView(record) : null,
  };
}

/** A request that came back without an answer leaves the record uncertain. */
async function sendDraft(
  actor: ContentActor,
  site: WordPressSite,
  record: PublishRecordRow,
  html: string,
) {
  const reply = await createWordPressDraft(site, {
    title: inertTitle(record.title),
    slug: record.slug,
    html,
  });
  const nowMs = Date.now();
  if (reply.kind !== "ok") {
    const settled = await PublishingRepository.settleRecord(
      actor.organizationId,
      record,
      ["sending"],
      reply.kind === "lost"
        ? { state: "uncertain" }
        : { state: "failed", failureCode: reply.code },
      nowMs,
    );
    return recorded(await latest(actor, record, settled));
  }
  const post = await getWordPressPost(site, reply.value.id);
  if (post.kind === "ok") {
    const settled = await settleFromPost(
      actor.organizationId,
      site,
      record,
      ["sending"],
      [post.value],
    );
    return recorded(await latest(actor, record, settled));
  }
  const settled = await PublishingRepository.settleRecord(
    actor.organizationId,
    record,
    ["sending"],
    { state: "uncertain", remotePostId: reply.value.id },
    nowMs,
  );
  return recorded(await latest(actor, record, settled));
}

async function publish(
  actor: ContentActor,
  raw: PublishDraftInput,
): Promise<PublishOutcome> {
  const input = publishDraftInputSchema.parse(raw);
  const access = await publishingAccess(actor, input.projectId, true);
  const { scope } = access;
  const opened = await openConnection(access, input.projectId);
  if ("refused" in opened) return refused(opened.refused);
  const { connection, site } = opened;
  if (connection.writeStatus !== "granted") return refused("grant_missing");
  const currentDraft = () =>
    eligibleDraft(
      actor,
      {
        projectId: input.projectId,
        contentId: input.contentId,
        revisionId: input.revisionId,
        expectedHeadVersion: input.expectedHeadVersion,
      },
      connection.origin,
    );
  // A claim that lost may have lost to a withdrawn approval, not to another request.
  const claimRefusal = async (otherwise: PublishingRefusal) => {
    const current = await currentDraft();
    return "refused" in current ? current.refused : otherwise;
  };
  const built = await currentDraft();
  if ("refused" in built) return refused(built.refused);
  const { draft, idempotencyKey, approval } = built;
  if (draft.contentHash !== input.expectedContentHash)
    return refused("preview_changed");
  const prior = await PublishingRepository.getRecordByKey(
    actor.organizationId,
    input.projectId,
    idempotencyKey,
  );
  if (!prior) {
    const admitted = await PublishingRepository.admitRecord(scope, {
      id: crypto.randomUUID(),
      projectId: input.projectId,
      contentId: input.contentId,
      revisionId: input.revisionId,
      idempotencyKey,
      origin: connection.origin,
      title: draft.title,
      slug: draft.slug,
      contentHash: draft.contentHash,
      approval,
      nowMs: Date.now(),
    });
    if (admitted) return sendDraft(actor, site, admitted, draft.html);
    const raced = await PublishingRepository.getRecordByKey(
      actor.organizationId,
      input.projectId,
      idempotencyKey,
    );
    return raced
      ? refused("not_ready", raced)
      : refused(await claimRefusal("grant_missing"));
  }
  if (["verified", "mismatch", "trashed"].includes(prior.state))
    return recorded(prior);
  if (prior.state !== "failed" && prior.state !== "not_found")
    return refused("not_ready", prior);
  // An earlier attempt may have landed since it was written off, so look first.
  const found = await findWordPressPostsByMarker(
    site,
    wordPressMarker(idempotencyKey),
    draft,
  );
  if (found.kind !== "ok")
    return refused(
      found.kind === "rejected" ? rejectionRefusal(found) : "check_failed",
      prior,
    );
  if (found.value.posts.length > 0) {
    const settled = await settleFromPost(
      actor.organizationId,
      site,
      prior,
      [prior.state],
      found.value.posts,
    );
    return recorded(await latest(actor, prior, settled));
  }
  if (found.value.ambiguous) return refused("ambiguous_match", prior);
  // The search can take a while, so everything it relied on is decided again.
  const latestDraft = await currentDraft();
  if ("refused" in latestDraft) return refused(latestDraft.refused, prior);
  if (latestDraft.draft.contentHash !== input.expectedContentHash)
    return refused("preview_changed", prior);
  const claimed = await PublishingRepository.claimRetry(
    scope,
    prior,
    {
      title: latestDraft.draft.title,
      slug: latestDraft.draft.slug,
      contentHash: latestDraft.draft.contentHash,
    },
    latestDraft.approval,
    Date.now(),
  );
  if (!claimed) return refused(await claimRefusal("not_ready"), prior);
  return sendDraft(actor, site, claimed, latestDraft.draft.html);
}

/**
 * Withdraws our own unedited draft. Core REST has no conditional delete, so the
 * checks run just before the request and a very late owner edit can slip past
 * them. WordPress keeps the post in its trash, where it can be restored.
 */
async function trash(
  actor: ContentActor,
  raw: PublishRecordInput,
): Promise<PublishOutcome> {
  const input = publishRecordInputSchema.parse(raw);
  const access = await publishingAccess(actor, input.projectId, true);
  const record = await loadRecord(actor, input);
  if (record.state !== "verified" && record.state !== "mismatch")
    return refused("not_ready", record);
  if (recordErased(record)) return refused("record_erased", record);
  if (record.remotePostId === null) return refused("post_missing", record);
  if (record.remoteContentHash !== record.contentHash)
    return refused("baseline_missing", record);
  const opened = await openConnection(access, input.projectId);
  if ("refused" in opened) return refused(opened.refused, record);
  if (opened.connection.origin !== record.origin)
    return refused("origin_mismatch", record);
  if (opened.connection.writeStatus !== "granted")
    return refused("grant_missing", record);
  const { site } = opened;
  const current = await getWordPressPost(site, record.remotePostId);
  if (current.kind === "lost") return refused("check_failed", record);
  if (current.kind === "rejected")
    return refused(
      postIsGone(current) ? "post_missing" : rejectionRefusal(current),
      record,
    );
  if (
    !current.value.content.raw.includes(wordPressMarker(record.idempotencyKey))
  )
    return refused("not_ours", record);
  if (current.value.status !== "draft") return refused("not_a_draft", record);
  const revisionId = await latestWordPressRevisionId(site, record.remotePostId);
  if (!(await unchangedSinceLastWrite(record, current.value, revisionId)))
    return refused("owner_edited", record);
  const claimed = await PublishingRepository.claimTrash(
    access.scope,
    record,
    Date.now(),
  );
  if (!claimed) {
    const now = await latest(actor, record, null);
    return refused(recordErased(now) ? "record_erased" : "grant_missing", now);
  }
  const reply = await trashWordPressPost(site, record.remotePostId);
  if (reply.kind === "rejected") {
    const settled = await PublishingRepository.settleRecord(
      actor.organizationId,
      claimed,
      ["trashing"],
      { state: record.state, failureCode: reply.code },
      Date.now(),
    );
    return refused(
      rejectionRefusal(reply),
      await latest(actor, claimed, settled),
    );
  }
  const after =
    reply.kind === "ok"
      ? await getWordPressPost(site, record.remotePostId)
      : null;
  const nowMs = Date.now();
  const settled = await PublishingRepository.settleRecord(
    actor.organizationId,
    claimed,
    ["trashing"],
    after?.kind === "ok" && after.value.status === "trash"
      ? {
          state: "trashed",
          remoteStatus: "trash",
          remoteModifiedGmt: after.value.modified_gmt,
          trashedAtMs: nowMs,
        }
      : { state: "trash_uncertain" },
    nowMs,
  );
  return recorded(await latest(actor, claimed, settled));
}

export const WordPressPublishingService = {
  preview,
  publish,
  reconcile: reconcileWordPressRecord,
  trash,
} as const;
