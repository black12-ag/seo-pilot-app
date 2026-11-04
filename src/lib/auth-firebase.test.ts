import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
const { testDb } = await vi.hoisted(async () => {
  const { createFirebaseTestDb } =
    await import("@/server/auth/firebase-test-db");
  return { testDb: await createFirebaseTestDb() };
});
vi.mock("cloudflare:workers", () => ({ env: testDb.environment }));
vi.mock("@/db", () => ({ db: testDb.db }));
vi.mock("@/db/runBatch", () => ({ runBatch: testDb.runBatch }));
import { FirebaseIdentityRepository as repository } from "@/server/auth/repositories/FirebaseIdentityRepository";
import type { VerifiedFirebaseIdentity } from "@/shared/firebase-auth";
const identity: VerifiedFirebaseIdentity = {
  firebaseProjectId: "test-firebase",
  firebaseUid: "uid",
  email: "authority@example.com",
  name: "Synthetic User",
  authTimeSeconds: 1,
  tokenExpiresAtMs: 2_000_000_000_000,
};
beforeEach(testDb.seedProject);
afterAll(testDb.close);
async function pending(email = "new@example.com", id = "invite") {
  await testDb.executeMultiple(
    `insert into invitation (id,organization_id,email,role,status,expires_at,inviter_id) values ('${id}','organization','${email}','admin','pending',${testDb.provider === "postgres" ? "now()+interval '1 hour'" : Date.now() + 3_600_000},'user');`,
  );
}
async function secondUser() {
  await testDb.executeMultiple(
    `insert into "user" (id,name,email,created_at,updated_at) values ('second','Second','second@example.com',${testDb.provider === "postgres" ? "now(),now()" : "0,0"});`,
  );
}
describe(`Firebase atomic identity SQL (${testDb.provider})`, () => {
  it("binds one Firebase UID to only one local user under a race", async () => {
    await secondUser();
    const results = await Promise.allSettled([
      repository.link("user", identity),
      repository.link("second", { ...identity, email: "second@example.com" }),
    ]);
    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect(
      await testDb.execute("select user_id from firebase_identities"),
    ).toHaveLength(1);
  });
  it("binds one local user to only one Firebase UID per project under a race", async () => {
    const results = await Promise.allSettled([
      repository.link("user", identity),
      repository.link("user", { ...identity, firebaseUid: "different" }),
    ]);
    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect(
      await testDb.execute("select firebase_uid from firebase_identities"),
    ).toHaveLength(1);
  });
  it("provisions user+identity atomically and deduplicates concurrent signups", async () => {
    await pending();
    const invited = { ...identity, email: "new@example.com" };
    const results = await Promise.allSettled([
      repository.provisionInvited(invited),
      repository.provisionInvited(invited),
    ]);
    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect(await testDb.execute('select id from "user"')).toHaveLength(2);
    expect(
      await testDb.execute("select user_id from firebase_identities"),
    ).toHaveLength(1);
  });
  it("rolls back the losing user when two valid invitations race for one UID", async () => {
    await pending();
    await pending("another@example.com", "another");
    const results = await Promise.allSettled([
      repository.provisionInvited({ ...identity, email: "new@example.com" }),
      repository.provisionInvited({
        ...identity,
        email: "another@example.com",
      }),
    ]);
    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect(await testDb.execute('select id from "user"')).toHaveLength(2);
  });
  it("rejects an invitation cancelled between read and batch without an orphan", async () => {
    await pending();
    testDb.beforeNextBatch(async () => {
      await testDb.execute("update invitation set status='canceled'");
    });
    await expect(
      repository.provisionInvited({ ...identity, email: "new@example.com" }),
    ).rejects.toBeTruthy();
    expect(await testDb.execute('select id from "user"')).toHaveLength(1);
    expect(
      await testDb.execute("select user_id from firebase_identities"),
    ).toHaveLength(0);
  });
  it("rolls back new user and mapping when a statement fails", async () => {
    await pending();
    testDb.failNextBatchAt(3);
    await expect(
      repository.provisionInvited({ ...identity, email: "new@example.com" }),
    ).rejects.toBeTruthy();
    expect(await testDb.execute('select id from "user"')).toHaveLength(1);
    expect(
      await testDb.execute("select user_id from firebase_identities"),
    ).toHaveLength(0);
  });
  it("atomically rejects mismatched proof/session/identity owners despite valid independent FKs", async () => {
    await secondUser();
    await repository.link("second", {
      ...identity,
      email: "second@example.com",
    });
    const date = testDb.provider === "postgres" ? "now()" : "0";
    await testDb.executeMultiple(
      `insert into session (id,user_id,token,expires_at,created_at,updated_at) values ('session','user','synthetic-session-token',${date},${date},${date});`,
    );
    await expect(
      repository.insertProof({
        sessionId: "session",
        userId: "second",
        firebaseProjectId: "test-firebase",
        firebaseUid: "uid",
        encryptedProof: "synthetic-ciphertext",
        authTimeSeconds: 1,
        tokenExpiresAtMs: 2_000,
        createdAtMs: 1,
      }),
    ).rejects.toBeTruthy();
    expect(
      await testDb.execute("select session_id from firebase_session_proofs"),
    ).toHaveLength(0);
  });
});
