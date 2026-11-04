import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

const { testDb } = await vi.hoisted(async () => {
  const { createSiteAuthorityTestDb } =
    await import("@/server/features/site-authority/siteAuthorityTestDb");
  return { testDb: await createSiteAuthorityTestDb() };
});
vi.mock("cloudflare:workers", () => ({
  env: { DATABASE_PROVIDER: testDb.provider },
}));
vi.mock("@/db", () => ({ db: testDb.db }));
vi.mock("@/db/runBatch", () => ({ runBatch: testDb.runBatch }));
import {
  grantedConnectionSql,
  publishingOrigin as origin,
  verifiedAuthoritySql,
} from "../publishingTestDb";
import { WordPressConnectionService as connections } from "./WordPressConnectionService";
import { sealWordPressCredential } from "./wordpressCredential";
import { fakeWordPress, type FakeWordPress } from "./fakeWordPress";

const password = "abcd efgh ijkl mnop qrst uvwx";
const actor = {
  userId: "user",
  organizationId: "organization",
  role: "owner",
  surface: "web" as const,
};
const projectId = "project";
let site: FakeWordPress;

const userRead = (url: URL) => url.pathname.endsWith("/users/me");

beforeEach(async () => {
  vi.stubEnv("BETTER_AUTH_SECRET", "x".repeat(40));
  vi.stubEnv("AUTH_MODE", "password");
  site = fakeWordPress(origin);
  vi.stubGlobal("fetch", vi.fn(site.fetch));
  await testDb.seedProject();
  const sealed = await sealWordPressCredential({
    username: "editor",
    applicationPassword: password,
    projectId,
    origin,
  });
  await testDb.executeMultiple(
    verifiedAuthoritySql() + grantedConnectionSql(sealed),
  );
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
afterAll(testDb.close);

describe(`a check that outlives a decision (${testDb.provider})`, () => {
  const grants = ["read", "write"] as const;

  it.each(grants)(
    "keeps %s access revoked when a slow check answers afterwards",
    async (grant) => {
      site.whenRequest(userRead, () =>
        connections.revokeGrant(actor, { projectId, grant }),
      );
      expect(await connections.checkGrant(actor, { projectId, grant })).toEqual(
        { status: "refused", reason: "grant_changed" },
      );
      expect(site.userReads).toBe(1);
      const { connection } = await connections.status(actor, { projectId });
      expect(connection?.[grant].status).toBe("revoked");
    },
  );

  it.each(grants)(
    "lets a check started after the revoke grant %s access again",
    async (grant) => {
      await connections.revokeGrant(actor, { projectId, grant });
      expect(
        await connections.checkGrant(actor, { projectId, grant }),
      ).toMatchObject({ connection: { [grant]: { status: "granted" } } });
    },
  );

  it.each(grants)(
    "drops a second revoke's slow %s check too, though the status looks the same",
    async (grant) => {
      await connections.revokeGrant(actor, { projectId, grant });
      site.whenRequest(userRead, () =>
        connections.revokeGrant(actor, { projectId, grant }),
      );
      expect(
        await connections.checkGrant(actor, { projectId, grant }),
      ).toMatchObject({ status: "refused", reason: "grant_changed" });
      const { connection } = await connections.status(actor, { projectId });
      expect(connection?.[grant].status).toBe("revoked");
    },
  );

  it("won't store a write check once read access was revoked during it", async () => {
    await connections.revokeGrant(actor, { projectId, grant: "write" });
    site.whenRequest(userRead, () =>
      connections.revokeGrant(actor, { projectId, grant: "read" }),
    );
    expect(
      await connections.checkGrant(actor, { projectId, grant: "write" }),
    ).toMatchObject({ status: "refused", reason: "grant_changed" });
    const { connection } = await connections.status(actor, { projectId });
    expect(connection?.write.status).toBe("revoked");
  });

  it("can't grant a password that was replaced during the check", async () => {
    site.whenRequest(userRead, () =>
      connections.connect(actor, {
        projectId,
        siteUrl: origin,
        username: "editor",
        applicationPassword: password,
      }),
    );
    expect(
      await connections.checkGrant(actor, { projectId, grant: "read" }),
    ).toMatchObject({ status: "refused", reason: "grant_changed" });
    const { connection } = await connections.status(actor, { projectId });
    expect(connection?.read.status).toBe("unchecked");
  });
});

describe(`connecting (${testDb.provider})`, () => {
  const input = {
    projectId,
    siteUrl: origin,
    username: "editor",
    applicationPassword: password,
  };

  it("saves without calling the site, and a new password needs new checks", async () => {
    expect(await connections.connect(actor, input)).toMatchObject({
      status: "saved",
      connection: {
        origin,
        read: { status: "unchecked" },
        write: { status: "unchecked" },
      },
    });
    expect(site.userReads).toBe(0);
    expect(
      await connections.checkGrant(actor, { projectId, grant: "write" }),
    ).toMatchObject({ status: "refused", reason: "grant_missing" });
    expect(
      await connections.checkGrant(actor, { projectId, grant: "read" }),
    ).toMatchObject({ connection: { read: { status: "granted" } } });
    expect(
      await connections.checkGrant(actor, { projectId, grant: "write" }),
    ).toMatchObject({ connection: { write: { status: "granted" } } });
    expect(site.creates).toBe(0);
  });

  it("refuses an address other than the verified site", async () => {
    expect(
      await connections.connect(actor, {
        ...input,
        siteUrl: "https://attacker.example.net",
      }),
    ).toEqual({ status: "refused", reason: "origin_mismatch" });
  });

  it("needs a verified site and an encryption key", async () => {
    await testDb.executeMultiple(
      "update project_site_authority set verified_until_ms = 2;",
    );
    expect(await connections.connect(actor, input)).toEqual({
      status: "refused",
      reason: "site_not_verified",
    });
    vi.stubEnv("BETTER_AUTH_SECRET", "");
    expect(await connections.connect(actor, input)).toEqual({
      status: "refused",
      reason: "encryption_unavailable",
    });
  });

  it("marks write as failed when the account lacks the capability", async () => {
    site.capabilities = { edit_posts: true };
    await connections.connect(actor, input);
    await connections.checkGrant(actor, { projectId, grant: "read" });
    expect(
      await connections.checkGrant(actor, { projectId, grant: "write" }),
    ).toMatchObject({ connection: { write: { status: "failed" } } });
  });

  it("marks read as failed on a refused password, and keeps its state on silence", async () => {
    await connections.connect(actor, input);
    site.failReads = true;
    expect(
      await connections.checkGrant(actor, { projectId, grant: "read" }),
    ).toEqual({ status: "refused", reason: "check_failed" });
    site.failReads = false;
    site.rejectAuth = true;
    expect(
      await connections.checkGrant(actor, { projectId, grant: "read" }),
    ).toMatchObject({ connection: { read: { status: "failed" } } });
  });

  it("won't open a password copied from another project or site", async () => {
    const copied = await sealWordPressCredential({
      username: "editor",
      applicationPassword: password,
      projectId: "foreign-project",
      origin,
    });
    await testDb.executeMultiple(
      `update wordpress_connections set sealed_credential = '${copied}';`,
    );
    expect(
      await connections.checkGrant(actor, { projectId, grant: "read" }),
    ).toEqual({ status: "refused", reason: "credential_unreadable" });
  });

  it("forgets the password on disconnect", async () => {
    await connections.disconnect(actor, { projectId });
    expect(await testDb.execute("select * from wordpress_connections")).toEqual(
      [],
    );
    expect(
      (await connections.status(actor, { projectId })).connection,
    ).toBeNull();
  });
});
