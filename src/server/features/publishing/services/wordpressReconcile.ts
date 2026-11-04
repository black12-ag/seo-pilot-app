import { AppError } from "@/server/lib/errors";
import type { ContentActor } from "@/types/schemas/content";
import {
  publishRecordInputSchema,
  type PublishingRefusal,
  type PublishOutcome,
  type PublishRecordInput,
} from "@/types/schemas/publishing";
import {
  PublishingRepository,
  type PublishRecordRow,
} from "../repositories/PublishingRepository";
import { openConnection, publishingAccess } from "./publishingAccess";
import { publishRecordView } from "./publishRecordView";
import {
  accessWithdrawn,
  findWordPressPostsByMarker,
  getWordPressPost,
  postIsGone,
  type WordPressRejection,
  type WordPressSite,
} from "./wordpressClient";
import { recordErased, wordPressMarker } from "./wordpressDraft";
import { settleFromPost } from "./wordpressReadback";

// A write still inside this window may yet land on the site, so an empty search
// or a quiet request says nothing about it.
const IN_FLIGHT_MS = 120_000;

export const refused = (
  reason: PublishingRefusal,
  record?: PublishRecordRow | null,
): PublishOutcome => ({
  status: "refused",
  reason,
  ...(record ? { record: publishRecordView(record) } : {}),
});
export const recorded = (record: PublishRecordRow): PublishOutcome => ({
  status: "recorded",
  record: publishRecordView(record),
});

export async function loadRecord(
  actor: ContentActor,
  input: PublishRecordInput,
) {
  const record = await PublishingRepository.getRecord(
    actor.organizationId,
    input.projectId,
    input.recordId,
  );
  if (!record) throw new AppError("NOT_FOUND");
  return record;
}

/** A refused request changes nothing, so this only picks what to tell the person. */
export function rejectionRefusal(reply: WordPressRejection): PublishingRefusal {
  if (accessWithdrawn(reply)) return "grant_missing";
  return reply.status === 404 ? "check_failed" : "remote_refused";
}

/** What a settle lost to a concurrent request: show the row that won. */
export async function latest(
  actor: ContentActor,
  record: PublishRecordRow,
  settled: PublishRecordRow | null,
) {
  return (
    settled ??
    (await PublishingRepository.getRecord(
      actor.organizationId,
      record.projectId,
      record.id,
    )) ??
    record
  );
}

async function reconcileTrash(
  actor: ContentActor,
  site: WordPressSite,
  record: PublishRecordRow,
): Promise<PublishOutcome> {
  if (record.remotePostId === null) return refused("post_missing", record);
  const reply = await getWordPressPost(site, record.remotePostId);
  const nowMs = Date.now();
  const from = [record.state];
  if (reply.kind === "ok" && reply.value.status !== "trash") {
    const settled = await settleFromPost(
      actor.organizationId,
      site,
      record,
      from,
      [reply.value],
    );
    return recorded(await latest(actor, record, settled));
  }
  if (reply.kind === "lost") return refused("check_failed", record);
  if (reply.kind === "rejected" && !postIsGone(reply))
    return refused(rejectionRefusal(reply), record);
  const settled = await PublishingRepository.settleRecord(
    actor.organizationId,
    record,
    from,
    {
      state: "trashed",
      failureCode: null,
      remoteStatus: reply.kind === "ok" ? reply.value.status : "missing",
      ...(reply.kind === "ok"
        ? { remoteModifiedGmt: reply.value.modified_gmt }
        : {}),
      trashedAtMs: nowMs,
    },
    nowMs,
  );
  return recorded(await latest(actor, record, settled));
}

/** Asks the site what happened. It only reads, so it can never add a second post. */
export async function reconcileWordPressRecord(
  actor: ContentActor,
  raw: PublishRecordInput,
): Promise<PublishOutcome> {
  const input = publishRecordInputSchema.parse(raw);
  const access = await publishingAccess(actor, input.projectId, true);
  const record = await loadRecord(actor, input);
  if (recordErased(record)) return refused("record_erased", record);
  const inFlight = Date.now() - record.lastAttemptAtMs < IN_FLIGHT_MS;
  if (
    record.state === "failed" ||
    record.state === "not_found" ||
    record.state === "trashed"
  )
    return refused("not_ready", record);
  if ((record.state === "sending" || record.state === "trashing") && inFlight)
    return refused("not_ready", record);
  const opened = await openConnection(access, input.projectId);
  if ("refused" in opened) return refused(opened.refused, record);
  if (opened.connection.origin !== record.origin)
    return refused("origin_mismatch", record);
  const { site } = opened;
  if (record.state === "trashing" || record.state === "trash_uncertain")
    return reconcileTrash(actor, site, record);
  const from = [record.state];
  if (record.remotePostId !== null) {
    const reply = await getWordPressPost(site, record.remotePostId);
    if (reply.kind === "lost") return refused("check_failed", record);
    if (reply.kind === "ok") {
      const settled = await settleFromPost(
        actor.organizationId,
        site,
        record,
        from,
        [reply.value],
      );
      return recorded(await latest(actor, record, settled));
    }
    if (!postIsGone(reply)) return refused(rejectionRefusal(reply), record);
    const settled = await PublishingRepository.settleRecord(
      actor.organizationId,
      record,
      from,
      // Never read back means it may never have landed. Otherwise the owner removed it.
      record.remoteStatus === null
        ? { state: "not_found", remotePostId: null }
        : {
            state: "mismatch",
            mismatchFields: JSON.stringify(["missing"]),
            remoteStatus: "missing",
            verifiedAtMs: null,
          },
      Date.now(),
    );
    return recorded(await latest(actor, record, settled));
  }
  const found = await findWordPressPostsByMarker(
    site,
    wordPressMarker(record.idempotencyKey),
    record,
  );
  if (found.kind !== "ok")
    return refused(
      found.kind === "rejected" ? rejectionRefusal(found) : "check_failed",
      record,
    );
  const { posts, ambiguous } = found.value;
  if (posts.length > 0) {
    const settled = await settleFromPost(
      actor.organizationId,
      site,
      record,
      from,
      posts,
    );
    return recorded(await latest(actor, record, settled));
  }
  if (inFlight) return refused("check_too_soon", record);
  const settled = await PublishingRepository.settleRecord(
    actor.organizationId,
    record,
    from,
    { state: ambiguous ? "uncertain" : "not_found" },
    Date.now(),
  );
  const now = await latest(actor, record, settled);
  return ambiguous ? refused("ambiguous_match", now) : recorded(now);
}
