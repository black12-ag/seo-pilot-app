import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { session, user } from "./better-auth-schema";

export const firebaseIdentities = sqliteTable(
  "firebase_identities",
  {
    firebaseProjectId: text("firebase_project_id").notNull(),
    firebaseUid: text("firebase_uid").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    createdAtMs: integer("created_at_ms").notNull(),
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
      sql`length(${t.firebaseProjectId}) > 0 and length(${t.firebaseUid}) > 0 and ${t.createdAtMs} between 0 and 9007199254740991 and ${t.createdAtMs} = cast(${t.createdAtMs} as integer)`,
    ),
  ],
);

export const firebaseSessionProofs = sqliteTable(
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
    authTimeSeconds: integer("auth_time_seconds").notNull(),
    tokenExpiresAtMs: integer("token_expires_at_ms").notNull(),
    createdAtMs: integer("created_at_ms").notNull(),
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
      sql`length(${t.encryptedProof}) > 0 and ${t.authTimeSeconds} between 0 and 9007199254740991 and ${t.authTimeSeconds} = cast(${t.authTimeSeconds} as integer) and ${t.tokenExpiresAtMs} between 0 and 9007199254740991 and ${t.tokenExpiresAtMs} = cast(${t.tokenExpiresAtMs} as integer) and ${t.createdAtMs} between 0 and 9007199254740991 and ${t.createdAtMs} = cast(${t.createdAtMs} as integer)`,
    ),
  ],
);
