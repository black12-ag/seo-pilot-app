import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { drizzle } from "drizzle-orm/postgres-js";
import { buildInventory } from "./inventory";
import { erasePostgres, verifyPostgres } from "./postgres";

const { testDb } = await vi.hoisted(async () => {
  const { createSiteAuthorityTestDb } =
    await import("../../src/server/features/site-authority/siteAuthorityTestDb");
  return { testDb: await createSiteAuthorityTestDb() };
});
const user = { id: "user", email: "authority@example.com", name: "User" };
const privateProof = crypto.randomUUID();
function database() {
  if (!testDb.pg) throw new Error("Isolated PostgreSQL fixture required");
  return drizzle(testDb.pg);
}
async function seedAuth(userId: string, sessionId: string, uid: string) {
  await testDb.executeMultiple(`
    insert into session (id,token,user_id,expires_at,created_at,updated_at) values ('${sessionId}','fixture-${sessionId}','${userId}',now()+interval '1 hour',now(),now());
    insert into firebase_identities (firebase_project_id,firebase_uid,user_id,created_at_ms) values ('fixture-project','${uid}','${userId}',1);
    insert into firebase_session_proofs (session_id,user_id,firebase_project_id,firebase_uid,encrypted_proof,auth_time_seconds,token_expires_at_ms,created_at_ms) values ('${sessionId}','${userId}','fixture-project','${uid}','${privateProof}',1,1000,1);
  `);
}
beforeEach(async () => {
  await testDb.executeMultiple(
    "delete from firebase_session_proofs; delete from firebase_identities;",
  );
  await testDb.seedProject();
});
afterAll(testDb.close);

describe.skipIf(testDb.provider !== "postgres")(
  "local Firebase erasure integration",
  () => {
    it("inventories only the target user's local rows without credential material", async () => {
      await seedAuth("user", "session", "uid");
      await testDb.execute(
        "insert into \"user\" (id,name,email,created_at,updated_at) values ('other','Other','other@example.com',now(),now())",
      );
      await seedAuth("other", "other-session", "other-uid");
      const inventory = await buildInventory(database(), user);
      expect(inventory.databaseCounts).toMatchObject({
        firebase_identities: 1,
        firebase_session_proofs: 1,
        sessions: 1,
      });
      expect(JSON.stringify(inventory).includes(privateProof)).toBe(false);
      expect(inventory.googleAccounts).toEqual([]);
    });
    it("actual user erasure cascades mappings and proofs, verifies zero, and preserves other users", async () => {
      await seedAuth("user", "session", "uid");
      await testDb.execute(
        "insert into \"user\" (id,name,email,created_at,updated_at) values ('other','Other','other@example.com',now(),now())",
      );
      await seedAuth("other", "other-session", "other-uid");
      const db = database();
      const inventory = await buildInventory(db, user);
      const organizations = inventory.organizations.map(
        (organization) => organization.id,
      );
      const receipt = await erasePostgres(db, user, organizations);
      expect(
        await verifyPostgres(db, user.id, organizations, receipt),
      ).toMatchObject({
        userRows: 0,
        organizationRows: 0,
        firebaseIdentityRows: 0,
        firebaseSessionProofRows: 0,
      });
      expect(
        await testDb.execute("select user_id from firebase_identities"),
      ).toEqual([{ user_id: "other" }]);
      expect(
        await testDb.execute("select user_id from firebase_session_proofs"),
      ).toEqual([{ user_id: "other" }]);
      expect(await testDb.execute("select user_id from session")).toEqual([
        { user_id: "other" },
      ]);
    });
    it("session deletion removes its proof while retaining the local identity for future sign-in", async () => {
      await seedAuth("user", "session", "uid");
      await testDb.execute("delete from session where id='session'");
      expect(
        (await buildInventory(database(), user)).databaseCounts,
      ).toMatchObject({
        firebase_identities: 1,
        firebase_session_proofs: 0,
        sessions: 0,
      });
    });
    it.each(["identity", "proof"])(
      "independent verification rejects a residual %s even after native user deletion",
      async (kind) => {
        const db = database();
        const receipt = await erasePostgres(db, user, ["organization"]);
        // Simulate a damaged restore in this disposable database, then independently
        // verify residual rows instead of trusting that FK cascades must have run.
        const insert =
          kind === "identity"
            ? "insert into firebase_identities (firebase_project_id,firebase_uid,user_id,created_at_ms) values ('fixture-project','orphan-uid','user',1)"
            : "insert into firebase_session_proofs (session_id,user_id,firebase_project_id,firebase_uid,encrypted_proof,auth_time_seconds,token_expires_at_ms,created_at_ms) values ('orphan-session','user','fixture-project','orphan-uid','opaque-fixture',1,1000,1)";
        if (!testDb.pg) throw new Error("Isolated PostgreSQL fixture required");
        await testDb.pg.begin(async (tx) => {
          await tx.unsafe("set local session_replication_role = replica");
          await tx.unsafe(insert);
        });
        await expect(
          verifyPostgres(db, user.id, ["organization"], receipt),
        ).rejects.toThrow("local Firebase authentication rows remain");
      },
    );
  },
);
