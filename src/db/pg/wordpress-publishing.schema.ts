import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  bigint,
  integer,
  pgTable,
  text,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { projects } from "./app.schema";
import { user } from "./better-auth-schema";
import { contentRevisions } from "./content.schema";

export const wordpressConnections = pgTable(
  "wordpress_connections",
  {
    projectId: text("project_id")
      .primaryKey()
      .references(() => projects.id, { onDelete: "cascade" }),
    origin: text("origin").notNull(),
    // Rotates with the password, so a check that outlives a reconnect cannot
    // grant access to the new credential.
    credentialId: text("credential_id").notNull(),
    sealedCredential: text("sealed_credential").notNull(),
    readStatus: text("read_status", {
      enum: ["unchecked", "granted", "failed", "revoked"],
    }).notNull(),
    writeStatus: text("write_status", {
      enum: ["unchecked", "granted", "failed", "revoked"],
    }).notNull(),
    readCheckedAtMs: bigint("read_checked_at_ms", { mode: "number" }),
    writeCheckedAtMs: bigint("write_checked_at_ms", { mode: "number" }),
    createdByUserId: text("created_by_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    createdAtMs: bigint("created_at_ms", { mode: "number" }).notNull(),
    updatedAtMs: bigint("updated_at_ms", { mode: "number" }).notNull(),
  },
  (t) => [
    check(
      "wordpress_connections_read_status_check",
      sql`${t.readStatus} in ('unchecked','granted','failed','revoked')`,
    ),
    check(
      "wordpress_connections_write_status_check",
      sql`${t.writeStatus} in ('unchecked','granted','failed','revoked')`,
    ),
  ],
);

export const wordpressPublishRecords = pgTable(
  "wordpress_publish_records",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id").notNull(),
    contentId: text("content_id").notNull(),
    revisionId: text("revision_id").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    origin: text("origin").notNull(),
    title: text("title").notNull(),
    slug: text("slug").notNull(),
    contentHash: text("content_hash").notNull(),
    state: text("state", {
      enum: [
        "sending",
        "uncertain",
        "not_found",
        "failed",
        "verified",
        "mismatch",
        "trashing",
        "trash_uncertain",
        "trashed",
      ],
    }).notNull(),
    attempt: integer("attempt").notNull(),
    lastAttemptAtMs: bigint("last_attempt_at_ms", { mode: "number" }).notNull(),
    failureCode: text("failure_code"),
    mismatchFields: text("mismatch_fields"),
    remotePostId: bigint("remote_post_id", { mode: "number" }),
    remoteRevisionId: bigint("remote_revision_id", { mode: "number" }),
    remoteModifiedGmt: text("remote_modified_gmt"),
    remoteStatus: text("remote_status"),
    remoteContentHash: text("remote_content_hash"),
    verifiedAtMs: bigint("verified_at_ms", { mode: "number" }),
    trashedAtMs: bigint("trashed_at_ms", { mode: "number" }),
    createdByUserId: text("created_by_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    createdAtMs: bigint("created_at_ms", { mode: "number" }).notNull(),
    updatedAtMs: bigint("updated_at_ms", { mode: "number" }).notNull(),
  },
  (t) => [
    uniqueIndex("wordpress_publish_records_project_key_uidx").on(
      t.projectId,
      t.idempotencyKey,
    ),
    index("wordpress_publish_records_project_created_idx").on(
      t.projectId,
      t.createdAtMs,
    ),
    index("wordpress_publish_records_revision_idx").on(
      t.projectId,
      t.contentId,
      t.revisionId,
    ),
    foreignKey({
      columns: [t.projectId, t.contentId, t.revisionId],
      foreignColumns: [
        contentRevisions.projectId,
        contentRevisions.contentId,
        contentRevisions.id,
      ],
    }).onDelete("cascade"),
    check(
      "wordpress_publish_records_state_check",
      sql`${t.state} in ('sending','uncertain','not_found','failed','verified','mismatch','trashing','trash_uncertain','trashed')`,
    ),
    check("wordpress_publish_records_attempt_check", sql`${t.attempt} >= 1`),
  ],
);
