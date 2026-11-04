import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

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
import { ContentRepository } from "@/server/features/content/repositories/ContentRepository";
import {
  contentTestScope,
  contentTestWrite,
} from "@/server/features/content/contentTestDb";
import {
  approvedReviewSql,
  grantedConnectionSql,
  heldApproval as approval,
  publishingOrigin as origin,
  publishingScope as scope,
  verifiedAuthoritySql,
} from "../publishingTestDb";
import { PublishingRepository as repository } from "./PublishingRepository";

const nowMs = 1_800_000_000_000;
const admission = {
  id: "record",
  projectId: "project",
  contentId: "content",
  revisionId: "revision",
  idempotencyKey: "key",
  origin,
  title: "Title",
  slug: "title",
  contentHash: "hash",
  approval,
  nowMs,
};
const admit = (input = admission, as = scope) =>
  repository.admitRecord(as, input);

beforeEach(async () => {
  await testDb.seedProject();
  await ContentRepository.createRevision(contentTestScope, contentTestWrite);
  await testDb.executeMultiple(
    verifiedAuthoritySql() + grantedConnectionSql() + approvedReviewSql(),
  );
});
afterAll(testDb.close);

describe(`publishing records (${testDb.provider})`, () => {
  it("admits one record per key, so only one request can ever be sent first", async () => {
    expect(await admit()).toMatchObject({ state: "sending", attempt: 1 });
    expect(await admit({ ...admission, id: "second" })).toBeNull();
    expect(
      await testDb.execute("select id from wordpress_publish_records"),
    ).toEqual([expect.objectContaining({ id: "record" })]);
  });

  it.each([
    ["a role without integration access", { ...scope, role: "member" }, ""],
    ["another organization", { ...scope, organizationId: "foreign" }, ""],
    [
      "a lapsed site authority",
      scope,
      "update project_site_authority set verified_until_ms = 2;",
    ],
    [
      "a revoked site authority",
      scope,
      "update project_site_authority set status = 'revoked', verified_until_ms = null, verified_at_ms = null, current_challenge_id = null;",
    ],
    [
      "a turned off write grant",
      scope,
      "update wordpress_connections set write_status = 'revoked';",
    ],
    [
      "a connection to another site",
      scope,
      "update wordpress_connections set origin = 'https://other.example.com';",
    ],
    [
      "a member removed just now",
      scope,
      "delete from member where user_id = 'user';",
    ],
  ])("refuses to admit for %s", async (_label, actor, change) => {
    if (change) await testDb.executeMultiple(change);
    expect(await admit(admission, actor)).toBeNull();
    expect(
      await testDb.execute("select id from wordpress_publish_records"),
    ).toEqual([]);
  });

  it.each([
    [
      "a withdrawn approval",
      "update content_review_requests set state = 'withdrawn', version = 3;",
    ],
    ["a newer review request", "update content_items set review_version = 2;"],
    ["a newer revision", "update content_items set head_version = 2;"],
    ["an archived item", "update content_items set archived_at_ms = 1;"],
    ["an erased revision", "update content_revisions set redacted_at_ms = 1;"],
  ])("refuses both claims after %s", async (_label, change) => {
    const admitted = await admit();
    if (!admitted) throw new Error("Not admitted");
    const failed = await repository.settleRecord(
      "organization",
      admitted,
      ["sending"],
      { state: "failed" },
      nowMs,
    );
    if (!failed) throw new Error("Not settled");
    await testDb.executeMultiple(change);
    expect(await admit({ ...admission, id: "b", idempotencyKey: "b" })).toBe(
      null,
    );
    expect(
      await repository.claimRetry(
        scope,
        failed,
        { title: "New", slug: "new", contentHash: "new-hash" },
        approval,
        nowMs,
      ),
    ).toBeNull();
  });

  it("lets one caller retry a refused attempt and refuses a stale one", async () => {
    const admitted = await admit();
    if (!admitted) throw new Error("Not admitted");
    const draft = { title: "New", slug: "new", contentHash: "new-hash" };
    expect(
      await repository.claimRetry(scope, admitted, draft, approval, nowMs),
    ).toBeNull();
    const failed = await repository.settleRecord(
      "organization",
      admitted,
      ["sending"],
      { state: "failed", failureCode: "rest_cannot_create" },
      nowMs,
    );
    if (!failed) throw new Error("Not settled");
    expect(
      await repository.claimRetry(scope, failed, draft, approval, nowMs),
    ).toMatchObject({
      state: "sending",
      attempt: 2,
      title: "New",
      failureCode: null,
    });
    expect(
      await repository.claimRetry(scope, failed, draft, approval, nowMs),
    ).toBeNull();
  });

  it("records what a request did even after the sender lost access", async () => {
    const admitted = await admit();
    if (!admitted) throw new Error("Not admitted");
    await testDb.executeMultiple("delete from member where user_id = 'user';");
    expect(
      await repository.settleRecord(
        "organization",
        admitted,
        ["sending"],
        { state: "uncertain" },
        nowMs,
      ),
    ).toMatchObject({ state: "uncertain" });
    expect(
      await repository.settleRecord(
        "foreign",
        admitted,
        ["uncertain"],
        { state: "verified" },
        nowMs,
      ),
    ).toBeNull();
  });

  it("drops a settle that belongs to an earlier attempt", async () => {
    const admitted = await admit();
    if (!admitted) throw new Error("Not admitted");
    await testDb.executeMultiple(
      "update wordpress_publish_records set attempt = 2;",
    );
    expect(
      await repository.settleRecord(
        "organization",
        admitted,
        ["sending"],
        { state: "not_found" },
        nowMs,
      ),
    ).toBeNull();
  });

  it("only moves a checked draft to trashing", async () => {
    const admitted = await admit();
    if (!admitted) throw new Error("Not admitted");
    expect(await repository.claimTrash(scope, admitted, nowMs)).toBeNull();
    const verified = await repository.settleRecord(
      "organization",
      admitted,
      ["sending"],
      { state: "verified", remotePostId: 5, remoteContentHash: "hash" },
      nowMs,
    );
    if (!verified) throw new Error("Not settled");
    await testDb.executeMultiple(
      "update wordpress_publish_records set remote_content_hash = 'other';",
    );
    expect(await repository.claimTrash(scope, verified, nowMs)).toBeNull();
    await testDb.executeMultiple(
      "update wordpress_publish_records set remote_content_hash = 'hash';",
    );
    expect(await repository.claimTrash(scope, verified, nowMs)).toMatchObject({
      state: "trashing",
    });
  });

  it("hides records and connections from another organization", async () => {
    await admit();
    expect(await repository.listRecords("foreign", "project")).toEqual([]);
    expect(
      await repository.getRecord("foreign", "project", "record"),
    ).toBeNull();
    expect(
      await repository.getRecordByKey("foreign", "project", "key"),
    ).toBeNull();
    expect(await repository.getConnection("foreign", "project")).toBeNull();
    expect(
      await repository.listRecords("organization", "project"),
    ).toHaveLength(1);
  });
});

describe(`publishing connections (${testDb.provider})`, () => {
  const usable = (needsRead: boolean, as = scope, needsWrite = false) =>
    repository.credentialUsable(as, {
      projectId: "project",
      credentialId: "credential",
      origin,
      needsRead,
      needsWrite,
      nowMs,
    });

  it("only lets a password go out under a live authority and a read grant", async () => {
    expect(await usable(true)).toBe(true);
    expect(await usable(true, { ...scope, role: "member" })).toBe(false);
    await testDb.executeMultiple(
      "update wordpress_connections set read_status = 'revoked';",
    );
    expect(await usable(true)).toBe(false);
    expect(await usable(false)).toBe(true);
    await testDb.executeMultiple(
      "update project_site_authority set status = 'revoked', verified_until_ms = null, verified_at_ms = null, current_challenge_id = null;",
    );
    expect(await usable(false)).toBe(false);
  });

  it("only lets a change go out under a current write and read grant", async () => {
    expect(await usable(false, scope, true)).toBe(true);
    expect(await usable(false, { ...scope, role: "member" }, true)).toBe(false);
    await testDb.executeMultiple(
      "update wordpress_connections set write_status = 'revoked';",
    );
    expect(await usable(true)).toBe(true);
    expect(await usable(false, scope, true)).toBe(false);
    await testDb.executeMultiple(
      "update wordpress_connections set write_status = 'granted', read_status = 'revoked';",
    );
    expect(await usable(false, scope, true)).toBe(false);
  });

  const connection = {
    projectId: "project",
    origin,
    credentialId: "new-credential",
    sealedCredential: "new-sealed",
    nowMs,
  };

  it("starts a new password with nothing granted, whatever the old one could do", async () => {
    expect(await repository.saveConnection(scope, connection)).toBe(true);
    expect(
      await repository.getConnection("organization", "project"),
    ).toMatchObject({
      credentialId: "new-credential",
      sealedCredential: "new-sealed",
      readStatus: "unchecked",
      writeStatus: "unchecked",
      readCheckedAtMs: null,
    });
  });

  it("stores a first connection for a verified site and refuses other sites", async () => {
    await testDb.executeMultiple("delete from wordpress_connections;");
    expect(
      await repository.saveConnection(scope, {
        ...connection,
        origin: "https://other.example.com",
      }),
    ).toBe(false);
    expect(await repository.saveConnection(scope, connection)).toBe(true);
    expect(
      await repository.saveConnection({ ...scope, role: "member" }, connection),
    ).toBe(false);
  });

  const storedConnection = async () => {
    const row = await repository.getConnection("organization", "project");
    if (!row) throw new Error("Not connected");
    return row;
  };
  const check = { grant: "read", status: "granted", nowMs } as const;

  it("drops a check result that belongs to a replaced password", async () => {
    const replaced = await storedConnection();
    await repository.saveConnection(scope, connection);
    expect(
      await repository.recordGrantCheck(scope, {
        ...check,
        connection: replaced,
      }),
    ).toBe(false);
    expect(
      await repository.recordGrantCheck(scope, {
        ...check,
        connection: await storedConnection(),
      }),
    ).toBe(true);
  });

  it("drops a check result once a revoke lands, even in the same millisecond", async () => {
    await repository.revokeGrant(scope, {
      projectId: "project",
      grant: "read",
      nowMs,
    });
    const seen = await storedConnection();
    await repository.revokeGrant(scope, {
      projectId: "project",
      grant: "read",
      nowMs,
    });
    expect(
      await repository.recordGrantCheck(scope, { ...check, connection: seen }),
    ).toBe(false);
    expect(await storedConnection()).toMatchObject({ readStatus: "revoked" });
  });

  it("drops the slower of two checks, on a clock running behind too", async () => {
    const seen = await storedConnection();
    const earlier = { ...check, connection: seen, nowMs: 0 };
    expect(await repository.recordGrantCheck(scope, earlier)).toBe(true);
    expect((await storedConnection()).readCheckedAtMs).toBe(2);
    expect(await repository.recordGrantCheck(scope, earlier)).toBe(false);
  });

  it("turns off a grant and removes the saved password only for its own workspace", async () => {
    await repository.revokeGrant(
      { ...scope, organizationId: "foreign" },
      { projectId: "project", grant: "write", nowMs },
    );
    await repository.deleteConnection(
      { ...scope, organizationId: "foreign" },
      "project",
    );
    expect(
      await repository.getConnection("organization", "project"),
    ).toMatchObject({ writeStatus: "granted" });
    await repository.revokeGrant(scope, {
      projectId: "project",
      grant: "write",
      nowMs,
    });
    expect(
      await repository.getConnection("organization", "project"),
    ).toMatchObject({ writeStatus: "revoked" });
    await repository.deleteConnection(scope, "project");
    expect(
      await repository.getConnection("organization", "project"),
    ).toBeNull();
  });
});
