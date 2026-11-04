import { z } from "zod";
import type { PublishRecordView } from "@/types/schemas/publishing";
import type { PublishRecordRow } from "../repositories/PublishingRepository";

const fieldsSchema = z.array(z.string());

function mismatchFields(stored: string | null) {
  if (!stored) return [];
  try {
    return fieldsSchema.parse(JSON.parse(stored));
  } catch {
    return [];
  }
}

export function publishRecordView(row: PublishRecordRow): PublishRecordView {
  return {
    id: row.id,
    contentId: row.contentId,
    revisionId: row.revisionId,
    origin: row.origin,
    title: row.title,
    state: row.state,
    attempt: row.attempt,
    failureCode: row.failureCode,
    mismatchFields: mismatchFields(row.mismatchFields),
    remotePostId: row.remotePostId,
    remoteRevisionId: row.remoteRevisionId,
    remoteModifiedGmt: row.remoteModifiedGmt,
    remoteStatus: row.remoteStatus,
    verifiedAtMs: row.verifiedAtMs,
    trashedAtMs: row.trashedAtMs,
    lastAttemptAtMs: row.lastAttemptAtMs,
    createdAtMs: row.createdAtMs,
    updatedAtMs: row.updatedAtMs,
  };
}
