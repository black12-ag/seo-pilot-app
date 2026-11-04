import { sort } from "remeda";
import type { PublishState } from "@/types/schemas/publishing";
import {
  PublishingRepository,
  type PublishRecordRow,
} from "../repositories/PublishingRepository";
import {
  latestWordPressRevisionId,
  type WordPressPost,
  type WordPressSite,
} from "./wordpressClient";
import { compareWordPressPost } from "./wordpressDraft";

/**
 * Records what the site really holds. `verified` only ever comes from here. The
 * baseline is the first read back that matches what we sent, and it stays, so
 * neither a later re-check nor an edit made before the first one can make an
 * owner's text look like our own write when someone trashes the draft.
 */
export async function settleFromPost(
  organizationId: string,
  site: WordPressSite,
  record: PublishRecordRow,
  from: PublishState[],
  posts: WordPressPost[],
) {
  const [post] = sort(posts, (a, b) => a.id - b.id);
  if (!post) throw new Error("A read back needs a post");
  const { contentHash, mismatches } = await compareWordPressPost(record, post);
  const fields = [...mismatches, ...(posts.length > 1 ? ["duplicate"] : [])];
  const nowMs = Date.now();
  const baseline = record.remoteContentHash === null && fields.length === 0;
  return PublishingRepository.settleRecord(
    organizationId,
    record,
    from,
    {
      state: fields.length > 0 ? "mismatch" : "verified",
      failureCode: null,
      mismatchFields: fields.length > 0 ? JSON.stringify(fields) : null,
      remotePostId: post.id,
      remoteStatus: post.status,
      verifiedAtMs: fields.length > 0 ? null : nowMs,
      ...(baseline
        ? {
            remoteRevisionId: await latestWordPressRevisionId(site, post.id),
            remoteModifiedGmt: post.modified_gmt,
            remoteContentHash: contentHash,
          }
        : {}),
    },
    nowMs,
  );
}
