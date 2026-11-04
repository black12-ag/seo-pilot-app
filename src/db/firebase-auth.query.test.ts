import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createSiteAuthorityTestDb } from "@/server/features/site-authority/siteAuthorityTestDb";

let testDb: Awaited<ReturnType<typeof createSiteAuthorityTestDb>>;
beforeAll(async () => {
  testDb = await createSiteAuthorityTestDb();
});
afterAll(async () => {
  await testDb.close();
});
beforeEach(async () => {
  await testDb.seedProject();
  const date = testDb.provider === "postgres" ? "now()" : "0";
  await testDb.executeMultiple(`insert into "user" (id,name,email,created_at,updated_at) values ('other-user','Other','other@example.com',${date},${date});
    insert into session (id,token,user_id,expires_at,created_at,updated_at) values ('session','session-token','user',${date},${date},${date}), ('other-session','other-token','other-user',${date},${date},${date});`);
});
const identity = (
  project = "firebase-project",
  uid = "uid",
  user = "user",
  createdAt = "10",
) =>
  `insert into firebase_identities (firebase_project_id,firebase_uid,user_id,created_at_ms) values ('${project}','${uid}','${user}',${createdAt})`;
const proof = ({
  sessionId = "session",
  user = "user",
  project = "firebase-project",
  uid = "uid",
  authTime = "10",
  expires = "20000",
  created = "10000",
}: {
  sessionId?: string;
  user?: string;
  project?: string;
  uid?: string;
  authTime?: string;
  expires?: string;
  created?: string;
} = {}) =>
  `insert into firebase_session_proofs (session_id,user_id,firebase_project_id,firebase_uid,encrypted_proof,auth_time_seconds,token_expires_at_ms,created_at_ms) values ('${sessionId}','${user}','${project}','${uid}','encrypted',${authTime},${expires},${created})`;

describe("Firebase identity and session proof migration", () => {
  it("enforces project and UID primary key and one UID per user in a project", async () => {
    await testDb.execute(identity());
    await expect(
      testDb.execute(identity("firebase-project", "uid", "other-user")),
    ).rejects.toThrow();
    await expect(
      testDb.execute(identity("firebase-project", "other-uid", "user")),
    ).rejects.toThrow();
    await testDb.execute(identity("another-project", "uid", "user"));
  });
  it("requires a real user, session and identity", async () => {
    await expect(
      testDb.execute(identity("firebase-project", "uid", "missing")),
    ).rejects.toThrow();
    await expect(testDb.execute(proof())).rejects.toThrow();
    await testDb.execute(identity());
    await expect(
      testDb.execute(proof({ sessionId: "missing" })),
    ).rejects.toThrow();
    await expect(testDb.execute(proof({ user: "missing" }))).rejects.toThrow();
    await testDb.execute(proof());
    await expect(testDb.execute(proof())).rejects.toThrow();
  });
  it("rejects empty identifiers and out-of-range timestamps", async () => {
    await expect(testDb.execute(identity("", "uid"))).rejects.toThrow();
    await expect(
      testDb.execute(identity("firebase-project", "")),
    ).rejects.toThrow();
    await expect(
      testDb.execute(identity("firebase-project", "uid", "user", "-1")),
    ).rejects.toThrow();
    await expect(
      testDb.execute(
        identity("firebase-project", "uid", "user", "9007199254740992"),
      ),
    ).rejects.toThrow();
    await testDb.execute(identity());
    await expect(
      testDb.execute(proof().replace("'encrypted'", "''")),
    ).rejects.toThrow();
    await expect(testDb.execute(proof({ authTime: "-1" }))).rejects.toThrow();
    await expect(
      testDb.execute(proof({ authTime: "1", expires: "9007199254740992" })),
    ).rejects.toThrow();
    await expect(
      testDb.execute(proof({ authTime: "1", expires: "10", created: "-1" })),
    ).rejects.toThrow();
  });
  it("cascades proof deletion when the identity or session is removed", async () => {
    await testDb.execute(identity());
    await testDb.execute(proof());
    await testDb.execute(
      "delete from firebase_identities where firebase_project_id='firebase-project' and firebase_uid='uid'",
    );
    expect(
      await testDb.execute("select session_id from firebase_session_proofs"),
    ).toHaveLength(0);
    await testDb.execute(identity());
    await testDb.execute(proof());
    await testDb.execute("delete from session where id='session'");
    expect(
      await testDb.execute("select session_id from firebase_session_proofs"),
    ).toHaveLength(0);
  });
  it("cascades identities and proofs on user deletion", async () => {
    await testDb.execute(identity());
    await testDb.execute(proof());
    await testDb.execute("delete from \"user\" where id='user'");
    expect(
      await testDb.execute("select user_id from firebase_identities"),
    ).toHaveLength(0);
    expect(
      await testDb.execute("select session_id from firebase_session_proofs"),
    ).toHaveLength(0);
  });
  it("leaves cross-owner equality to the repository guard", async () => {
    await testDb.execute(identity());
    await testDb.execute(
      proof({ sessionId: "other-session", user: "other-user" }),
    );
    expect(
      await testDb.execute("select session_id from firebase_session_proofs"),
    ).toHaveLength(1);
  });
});
