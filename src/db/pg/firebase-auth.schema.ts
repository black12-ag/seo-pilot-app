import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  foreignKey,
  index,
  primaryKey,
  pgTable,
  text,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { session, user } from "./better-auth-schema";

export const firebaseIdentities = pgTable(
  "firebase_identities",
  {
    firebaseProjectId: text("firebase_project_id").notNull(),
    firebaseUid: text("firebase_uid").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    createdAtMs: bigint("created_at_ms", { mode: "number" }).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.firebaseProjectId, t.firebaseUid] }),
    uniqueIndex("firebase_identities_project_user_uidx").on(
      t.firebaseProjectId,
      t.userId,
    ),
    index("firebase_identities_user_idx").on(t.userId),
    check(
      "firebase_identities_fields_check",
      sql`length(${t.firebaseProjectId}) > 0 and length(${t.firebaseUid}) > 0 and ${t.createdAtMs} between 0 and 9007199254740991`,
    ),
  ],
);

export const firebaseSessionProofs = pgTable(
  "firebase_session_proofs",
  {
    sessionId: text("session_id")
      .primaryKey()
      .references(() => session.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    firebaseProjectId: text("firebase_project_id").notNull(),
    firebaseUid: text("firebase_uid").notNull(),
    encryptedProof: text("encrypted_proof").notNull(),
    authTimeSeconds: bigint("auth_time_seconds", { mode: "number" }).notNull(),
    tokenExpiresAtMs: bigint("token_expires_at_ms", {
      mode: "number",
    }).notNull(),
    createdAtMs: bigint("created_at_ms", { mode: "number" }).notNull(),
  },
  (t) => [
    foreignKey({
      columns: [t.firebaseProjectId, t.firebaseUid],
      foreignColumns: [
        firebaseIdentities.firebaseProjectId,
        firebaseIdentities.firebaseUid,
      ],
    }).onDelete("cascade"),
    index("firebase_session_proofs_user_idx").on(t.userId),
    index("firebase_session_proofs_identity_idx").on(
      t.firebaseProjectId,
      t.firebaseUid,
    ),
    check(
      "firebase_session_proofs_fields_check",
      sql`length(${t.encryptedProof}) > 0 and ${t.authTimeSeconds} between 0 and 9007199254740991 and ${t.tokenExpiresAtMs} between 0 and 9007199254740991 and ${t.createdAtMs} between 0 and 9007199254740991`,
    ),
  ],
);
