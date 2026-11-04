import { z } from "zod";

const id = z.string().min(1).max(255);
const projectId = id;

export const publishingProjectInputSchema = z.strictObject({ projectId });
export const connectWordPressInputSchema = z.strictObject({
  projectId,
  siteUrl: z.string().trim().min(1).max(2048),
  username: z.string().trim().min(1).max(100),
  applicationPassword: z.string().trim().min(16).max(200),
});
export const wordPressGrantSchema = z.enum(["read", "write"]);
export const wordPressGrantInputSchema = z.strictObject({
  projectId,
  grant: wordPressGrantSchema,
});
export const publishPreviewInputSchema = z.strictObject({
  projectId,
  contentId: id,
});
export const publishDraftInputSchema = z.strictObject({
  projectId,
  contentId: id,
  revisionId: id,
  expectedHeadVersion: z.number().int().nonnegative(),
  expectedContentHash: z.string().regex(/^[a-f0-9]{64}$/),
});
export const publishRecordInputSchema = z.strictObject({
  projectId,
  recordId: id,
});

export type WordPressGrant = z.infer<typeof wordPressGrantSchema>;
export type ConnectWordPressInput = z.infer<typeof connectWordPressInputSchema>;
export type WordPressGrantInput = z.infer<typeof wordPressGrantInputSchema>;
export type PublishPreviewInput = z.infer<typeof publishPreviewInputSchema>;
export type PublishDraftInput = z.infer<typeof publishDraftInputSchema>;
export type PublishRecordInput = z.infer<typeof publishRecordInputSchema>;

/** Why a connection or publishing step did not run. Nothing was sent. */
export type PublishingRefusal =
  | "transport_unavailable"
  | "encryption_unavailable"
  | "site_not_verified"
  | "origin_mismatch"
  | "not_connected"
  | "credential_unreadable"
  | "grant_missing"
  | "grant_changed"
  | "preview_changed"
  | "title_missing"
  | "not_ready"
  | "ambiguous_match"
  | "not_ours"
  | "not_a_draft"
  | "owner_edited"
  | "baseline_missing"
  | "record_erased"
  | "post_missing"
  | "check_failed"
  | "remote_refused"
  | (string & {});

export type PublishState =
  | "sending"
  | "uncertain"
  | "not_found"
  | "failed"
  | "verified"
  | "mismatch"
  | "trashing"
  | "trash_uncertain"
  | "trashed";

/** What the client may see. The idempotency key and credential stay server-side. */
export type PublishRecordView = {
  id: string;
  contentId: string;
  revisionId: string;
  origin: string;
  title: string;
  state: PublishState;
  attempt: number;
  failureCode: string | null;
  mismatchFields: string[];
  remotePostId: number | null;
  remoteRevisionId: number | null;
  remoteModifiedGmt: string | null;
  remoteStatus: string | null;
  verifiedAtMs: number | null;
  trashedAtMs: number | null;
  lastAttemptAtMs: number;
  createdAtMs: number;
  updatedAtMs: number;
};

export type PublishOutcome =
  | { status: "refused"; reason: PublishingRefusal; record?: PublishRecordView }
  | { status: "recorded"; record: PublishRecordView };

export type WordPressGrantStatus =
  | "unchecked"
  | "granted"
  | "failed"
  | "revoked";

export type WordPressConnectionSummary = {
  origin: string;
  read: { status: WordPressGrantStatus; checkedAtMs: number | null };
  write: { status: WordPressGrantStatus; checkedAtMs: number | null };
  createdAtMs: number;
  updatedAtMs: number;
};

export type ConnectionOutcome =
  | { status: "refused"; reason: PublishingRefusal }
  | { status: "saved"; connection: WordPressConnectionSummary };

export type PublishingStatus = {
  canManage: boolean;
  transportAvailable: boolean;
  encryptionAvailable: boolean;
  authority: { verified: boolean; origin: string | null };
  connection: WordPressConnectionSummary | null;
  records: PublishRecordView[];
};

export type PublishPreview =
  | { status: "blocked"; reason: PublishingRefusal }
  | {
      status: "ready";
      origin: string;
      title: string;
      slug: string;
      html: string;
      contentHash: string;
      revisionId: string;
      headVersion: number;
      record: PublishRecordView | null;
    };
