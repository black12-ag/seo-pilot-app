import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
const { testDb } = await vi.hoisted(async () => {
  const { createFirebaseTestDb } = await import("./firebase-test-db");
  return { testDb: await createFirebaseTestDb() };
});
vi.mock("cloudflare:workers", () => ({
  env: testDb.environment,
  waitUntil: () => {},
}));
vi.mock("@/db", () => ({ db: testDb.db }));
vi.mock("@/db/d1/client", () => ({ d1Db: testDb.db }));
vi.mock("@/db/pg/client", () => ({ pgDb: testDb.db }));
vi.mock("@/db/runBatch", () => ({ runBatch: testDb.runBatch }));
import { getAuth } from "@/lib/auth";
import {
  resolveActiveHostedOrganization,
  resolveSignInHostedOrganization,
} from "./default-hosted-organization";

const createOrganization = (body: {
  userId: string;
  name: string;
  slug: string;
}) => getAuth().api.createOrganization({ body });
beforeEach(testDb.seedProject);
afterAll(testDb.close);
describe(`default organization resolution (${testDb.provider})`, () => {
  it("preserves a current owner membership", async () => {
    expect(
      await resolveSignInHostedOrganization("user", createOrganization),
    ).toEqual({ organizationId: "organization", role: "owner" });
  });
  it("preserves password-only default-workspace creation", async () => {
    await testDb.execute("delete from member");
    const result = await resolveSignInHostedOrganization(
      "user",
      createOrganization,
    );
    expect(result?.role).toBe("owner");
    expect(result?.organizationId).toBeTruthy();
    expect(await testDb.execute("select id from organization")).toHaveLength(3);
  });
  it("never creates a default workspace for a membership-less Firebase identity", async () => {
    await testDb.executeMultiple(
      "delete from member; insert into firebase_identities (firebase_project_id,firebase_uid,user_id,created_at_ms) values ('test-firebase','uid','user',0);",
    );
    expect(
      await resolveSignInHostedOrganization("user", createOrganization),
    ).toBeNull();
    await expect(
      resolveActiveHostedOrganization("user", createOrganization),
    ).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
    expect(await testDb.execute("select id from organization")).toHaveLength(2);
  });
});
