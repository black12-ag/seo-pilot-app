import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { getDatabaseProvider } from "@/db/provider";
import { runBatch } from "@/db/runBatch";
import {
  firebaseIdentities,
  firebaseSessionProofs,
  invitation,
  organization,
  session,
  user,
} from "@/db/schema";
import type { VerifiedFirebaseIdentity } from "@/shared/firebase-auth";

async function findIdentity(firebaseProjectId: string, firebaseUid: string) {
  const [record] = await db
    .select({ identity: firebaseIdentities, user })
    .from(firebaseIdentities)
    .innerJoin(user, eq(user.id, firebaseIdentities.userId))
    .where(
      and(
        eq(firebaseIdentities.firebaseProjectId, firebaseProjectId),
        eq(firebaseIdentities.firebaseUid, firebaseUid),
      ),
    )
    .limit(1);
  return record ?? null;
}

async function isBound(userId: string) {
  const [record] = await db
    .select({ userId: firebaseIdentities.userId })
    .from(firebaseIdentities)
    .where(eq(firebaseIdentities.userId, userId))
    .limit(1);
  return Boolean(record);
}

async function findUserByEmail(email: string) {
  const [record] = await db
    .select({ id: user.id })
    .from(user)
    .where(eq(sql`lower(${user.email})`, email.toLowerCase()))
    .limit(1);
  return record ?? null;
}

function invitationIsCurrent(email: string) {
  const unexpired =
    getDatabaseProvider() === "postgres"
      ? sql`${invitation.expiresAt} > clock_timestamp()`
      : sql`${invitation.expiresAt} > cast(unixepoch('subsecond') * 1000 as integer)`;
  return and(
    eq(sql`lower(${invitation.email})`, email.toLowerCase()),
    eq(invitation.status, "pending"),
    unexpired,
  );
}

async function provisionInvited(identity: VerifiedFirebaseIdentity) {
  const [pending] = await db
    .select({ id: invitation.id, organizationId: invitation.organizationId })
    .from(invitation)
    .where(invitationIsCurrent(identity.email))
    .limit(1);
  if (!pending) return null;
  const userId = crypto.randomUUID();
  const now = new Date();
  // Both dialects lock the invitation before the conditional insert. A stale
  // invitation makes email NULL, failing NOT NULL and rolling back the batch.
  await runBatch((tx) => [
    tx
      .update(organization)
      .set({ name: sql`${organization.name}` })
      .where(eq(organization.id, pending.organizationId)),
    tx
      .update(invitation)
      .set({ status: sql`${invitation.status}` })
      .where(eq(invitation.id, pending.id)),
    tx.insert(user).values({
      id: userId,
      name: identity.name,
      email: sql`(select ${identity.email} from ${invitation} where ${invitation.id} = ${pending.id} and ${invitationIsCurrent(identity.email)} limit 1)`,
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
    }),
    tx.insert(firebaseIdentities).values({
      firebaseProjectId: identity.firebaseProjectId,
      firebaseUid: identity.firebaseUid,
      userId,
      createdAtMs: now.getTime(),
    }),
  ]);
  return findIdentity(identity.firebaseProjectId, identity.firebaseUid);
}

async function link(userId: string, identity: VerifiedFirebaseIdentity) {
  await runBatch((tx) => [
    tx
      .update(user)
      .set({ name: sql`${user.name}` })
      .where(eq(user.id, userId)),
    tx.insert(firebaseIdentities).values({
      firebaseProjectId: identity.firebaseProjectId,
      firebaseUid: identity.firebaseUid,
      userId: sql`(select ${user.id} from ${user} where ${user.id} = ${userId} and lower(${user.email}) = ${identity.email})`,
      createdAtMs: Date.now(),
    }),
  ]);
}

async function insertProof(proof: typeof firebaseSessionProofs.$inferInsert) {
  await db.insert(firebaseSessionProofs).values({
    ...proof,
    userId: sql`(select ${session.userId} from ${session}
      inner join ${firebaseIdentities} on ${firebaseIdentities.userId} = ${session.userId}
      where ${session.id} = ${proof.sessionId} and ${session.userId} = ${proof.userId}
      and ${firebaseIdentities.firebaseProjectId} = ${proof.firebaseProjectId}
      and ${firebaseIdentities.firebaseUid} = ${proof.firebaseUid})`,
  });
}

async function getProof(sessionId: string) {
  const [record] = await db
    .select({
      proof: firebaseSessionProofs,
      identityUserId: firebaseIdentities.userId,
      sessionUserId: session.userId,
    })
    .from(firebaseSessionProofs)
    .innerJoin(
      firebaseIdentities,
      and(
        eq(
          firebaseIdentities.firebaseProjectId,
          firebaseSessionProofs.firebaseProjectId,
        ),
        eq(firebaseIdentities.firebaseUid, firebaseSessionProofs.firebaseUid),
      ),
    )
    .innerJoin(session, eq(session.id, firebaseSessionProofs.sessionId))
    .where(eq(firebaseSessionProofs.sessionId, sessionId))
    .limit(1);
  return record ?? null;
}

export const FirebaseIdentityRepository = {
  findIdentity,
  isBound,
  findUserByEmail,
  provisionInvited,
  link,
  insertProof,
  getProof,
};
