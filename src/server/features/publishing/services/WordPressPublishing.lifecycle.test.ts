import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

const { testDb, eligibility } = await vi.hoisted(async () => {
  const { createSiteAuthorityTestDb } =
    await import("@/server/features/site-authority/siteAuthorityTestDb");
  return {
    testDb: await createSiteAuthorityTestDb(),
    eligibility: { current: vi.fn() },
  };
});
vi.mock("cloudflare:workers", () => ({
  env: { DATABASE_PROVIDER: testDb.provider },
}));
vi.mock("@/db", () => ({ db: testDb.db }));
vi.mock("@/db/runBatch", () => ({ runBatch: testDb.runBatch }));
vi.mock("@/server/features/content/services/ContentReviewService", () => ({
  ContentReviewService: { currentEligibility: eligibility.current },
}));
import { ContentRepository } from "@/server/features/content/repositories/ContentRepository";
import {
  contentTestScope,
  contentTestWrite,
} from "@/server/features/content/contentTestDb";
import {
  approvedReviewSql,
  grantedConnectionSql,
  publishingOrigin as origin,
  verifiedAuthoritySql,
} from "../publishingTestDb";
import { WordPressConnectionService as connections } from "./WordPressConnectionService";
import { WordPressPublishingService as service } from "./WordPressPublishingService";
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
const contentId = "content";
const revisionId = "revision";
let site: FakeWordPress;

const approved = {
  eligible: true,
  value: {
    metadata: { title: "Title", slug: "title" },
    markdown: "Hello **world**\n\n<script>alert(1)</script>",
    review: { requestId: "request", version: 2 },
  },
};

async function previewed() {
  const preview = await service.preview(actor, { projectId, contentId });
  if (preview.status !== "ready") throw new Error(preview.reason);
  return preview;
}
async function send() {
  const preview = await previewed();
  return service.publish(actor, {
    projectId,
    contentId,
    revisionId: preview.revisionId,
    expectedHeadVersion: preview.headVersion,
    expectedContentHash: preview.contentHash,
  });
}
async function sent() {
  const outcome = await send();
  if (outcome.status !== "recorded") throw new Error(outcome.reason);
  return outcome.record;
}
const outOfWindow = () =>
  testDb.executeMultiple(
    "update wordpress_publish_records set last_attempt_at_ms = 1;",
  );
const recordInput = (recordId: string) => ({ projectId, recordId });

beforeEach(async () => {
  vi.stubEnv("BETTER_AUTH_SECRET", "x".repeat(40));
  vi.stubEnv("AUTH_MODE", "password");
  site = fakeWordPress(origin);
  vi.stubGlobal("fetch", vi.fn(site.fetch));
  eligibility.current.mockReset();
  eligibility.current.mockResolvedValue(approved);
  await testDb.seedProject();
  await ContentRepository.createRevision(contentTestScope, contentTestWrite);
  const sealed = await sealWordPressCredential({
    username: "editor",
    applicationPassword: password,
    projectId,
    origin,
  });
  await testDb.executeMultiple(
    verifiedAuthoritySql() + grantedConnectionSql(sealed) + approvedReviewSql(),
  );
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
afterAll(testDb.close);

describe(`sending a draft (${testDb.provider})`, () => {
  it("creates one draft, reads it back, and stays out of the way on a repeat", async () => {
    const record = await sent();
    expect(record).toMatchObject({
      state: "verified",
      remotePostId: site.posts[0]?.id,
      remoteStatus: "draft",
      remoteRevisionId: 900,
    });
    expect(record.verifiedAtMs).not.toBeNull();
    expect(site.posts).toHaveLength(1);
    expect(site.posts[0]?.status).toBe("draft");
    expect(site.authorization).toBe(`Basic ${btoa(`editor:${password}`)}`);
    expect(await sent()).toMatchObject({ id: record.id, state: "verified" });
    expect(site.creates).toBe(1);
  });

  it("keeps raw page text from reaching the site as markup", async () => {
    await sent();
    expect(site.posts[0]?.content.raw).not.toContain("<script>");
  });

  it("keeps the password and the key out of everything the client gets", async () => {
    const record = await sent();
    const status = await connections.status(actor, { projectId });
    const shown = JSON.stringify({ record, status });
    expect(shown).not.toContain(password);
    expect(shown).not.toContain("idempotency");
    const [row] = await testDb.execute(
      "select sealed_credential from wordpress_connections",
    );
    expect(JSON.stringify(row)).not.toContain(password);
  });

  it("sends nothing when the content is not approved", async () => {
    eligibility.current.mockResolvedValue({
      eligible: false,
      reason: "review_missing",
    });
    expect(await service.preview(actor, { projectId, contentId })).toEqual({
      status: "blocked",
      reason: "review_missing",
    });
    expect(
      await service.publish(actor, {
        projectId,
        contentId,
        revisionId,
        expectedHeadVersion: 1,
        expectedContentHash: "a".repeat(64),
      }),
    ).toMatchObject({ status: "refused", reason: "review_missing" });
    expect(site.creates).toBe(0);
  });

  it("refuses when the previewed body is not the body it would send", async () => {
    expect(
      await service.publish(actor, {
        projectId,
        contentId,
        revisionId,
        expectedHeadVersion: 1,
        expectedContentHash: "a".repeat(64),
      }),
    ).toMatchObject({ status: "refused", reason: "preview_changed" });
    expect(site.creates).toBe(0);
    expect(
      await testDb.execute("select id from wordpress_publish_records"),
    ).toEqual([]);
  });

  it.each([
    [
      "a site that isn't verified",
      "update project_site_authority set verified_until_ms = 2;",
      "site_not_verified",
    ],
    [
      "write access that was turned off",
      "update wordpress_connections set write_status = 'revoked';",
      "grant_missing",
    ],
  ])("sends nothing with %s", async (_label, change, reason) => {
    const preview = await previewed();
    await testDb.executeMultiple(change);
    const outcome = await service.publish(actor, {
      projectId,
      contentId,
      revisionId: preview.revisionId,
      expectedHeadVersion: preview.headVersion,
      expectedContentHash: preview.contentHash,
    });
    expect(outcome).toMatchObject({ status: "refused", reason });
    expect(site.creates).toBe(0);
  });

  it("is only reachable by a manager in the web app", async () => {
    const input = {
      projectId,
      contentId,
      revisionId,
      expectedHeadVersion: 1,
      expectedContentHash: "a".repeat(64),
    };
    await expect(
      service.publish({ ...actor, surface: "mcp" }, input),
    ).rejects.toThrow();
    await testDb.executeMultiple("update member set role = 'member';");
    await expect(service.publish(actor, input)).rejects.toThrow();
    await expect(
      service.publish({ ...actor, organizationId: "foreign" }, input),
    ).rejects.toThrow();
    expect(site.creates).toBe(0);
  });

  it("reports a stored post that differs and never calls it verified", async () => {
    site.filterContent = (html) => html.replace("world", "edited");
    expect(await sent()).toMatchObject({
      state: "mismatch",
      mismatchFields: ["content"],
      verifiedAtMs: null,
    });
  });

  it("records a refusal and retries only after looking for an earlier attempt", async () => {
    site.nextCreate = "reject";
    const failed = await sent();
    expect(failed).toMatchObject({
      state: "failed",
      failureCode: "rest_cannot_create",
    });
    expect(await sent()).toMatchObject({
      id: failed.id,
      state: "verified",
      attempt: 2,
    });
    expect(site.searches).toBeGreaterThan(0);
    expect(site.posts).toHaveLength(1);
  });
});

describe(`an answer that never came back (${testDb.provider})`, () => {
  it.each(["lost_before_insert", "lost_after_insert"] as const)(
    "goes uncertain and refuses to resend after %s",
    async (mode) => {
      site.nextCreate = mode;
      const record = await sent();
      expect(record.state).toBe("uncertain");
      expect(await send()).toMatchObject({
        status: "refused",
        reason: "not_ready",
      });
      expect(site.creates).toBe(1);
    },
  );

  it("adopts the post it finds rather than sending another", async () => {
    site.nextCreate = "lost_after_insert";
    const record = await sent();
    expect(
      await service.reconcile(actor, recordInput(record.id)),
    ).toMatchObject({ status: "recorded", record: { state: "verified" } });
    expect(site.posts).toHaveLength(1);
    expect(site.creates).toBe(1);
  });

  it("waits out a write that might still land before saying it isn't there", async () => {
    site.nextCreate = "lost_before_insert";
    const record = await sent();
    expect(
      await service.reconcile(actor, recordInput(record.id)),
    ).toMatchObject({ status: "refused", reason: "check_too_soon" });
    await outOfWindow();
    expect(
      await service.reconcile(actor, recordInput(record.id)),
    ).toMatchObject({ status: "recorded", record: { state: "not_found" } });
    expect(await sent()).toMatchObject({ state: "verified", attempt: 2 });
    expect(site.posts).toHaveLength(1);
  });

  it("stays uncertain when the search itself fails", async () => {
    site.nextCreate = "lost_before_insert";
    const record = await sent();
    await outOfWindow();
    site.failReads = true;
    expect(
      await service.reconcile(actor, recordInput(record.id)),
    ).toMatchObject({
      status: "refused",
      reason: "check_failed",
      record: { state: "uncertain" },
    });
  });

  it("flags a second post carrying the same marker", async () => {
    site.nextCreate = "lost_after_insert";
    const record = await sent();
    site.duplicateLast();
    expect(
      await service.reconcile(actor, recordInput(record.id)),
    ).toMatchObject({
      record: { state: "mismatch", mismatchFields: ["duplicate"] },
    });
  });

  it("rescues a record stuck sending after a crash, but only once it is safe", async () => {
    await testDb.executeMultiple(
      "insert into wordpress_publish_records (id,project_id,content_id,revision_id,idempotency_key,origin,title,slug,content_hash,state,attempt,last_attempt_at_ms,created_at_ms,updated_at_ms) values ('stuck','project','content','revision','stuck-key','https://example.com','Title','title','hash','sending',1,9000000000000,1,1);",
    );
    expect(await service.reconcile(actor, recordInput("stuck"))).toMatchObject({
      status: "refused",
      reason: "not_ready",
    });
    await outOfWindow();
    expect(await service.reconcile(actor, recordInput("stuck"))).toMatchObject({
      status: "recorded",
      record: { state: "not_found" },
    });
  });

  it("re-reading a checked draft reports an owner edit without forgiving it", async () => {
    const record = await sent();
    site.ownerEdit();
    expect(
      await service.reconcile(actor, recordInput(record.id)),
    ).toMatchObject({
      record: { state: "mismatch", mismatchFields: ["content"] },
    });
    expect(await service.trash(actor, recordInput(record.id))).toMatchObject({
      status: "refused",
      reason: "owner_edited",
    });
    expect(site.posts[0]?.status).toBe("draft");
  });
});

describe(`withdrawing a draft (${testDb.provider})`, () => {
  it("moves our unedited draft to trash and reads that back", async () => {
    const record = await sent();
    expect(await service.trash(actor, recordInput(record.id))).toMatchObject({
      status: "recorded",
      record: { state: "trashed", remoteStatus: "trash" },
    });
    expect(site.posts[0]?.status).toBe("trash");
    expect(await sent()).toMatchObject({ state: "trashed" });
    expect(site.creates).toBe(1);
  });

  it.each([
    ["not_a_draft", () => site.ownerPublish()],
    ["not_ours", () => site.ownerReplace()],
    ["post_missing", () => site.ownerDelete()],
  ])("refuses with %s and leaves the post alone", async (reason, change) => {
    const record = await sent();
    change();
    expect(await service.trash(actor, recordInput(record.id))).toMatchObject({
      status: "refused",
      reason,
    });
    expect(site.trashes).toBe(0);
  });

  it("goes back to the checked state when WordPress refuses", async () => {
    const record = await sent();
    site.nextTrash = "reject";
    expect(await service.trash(actor, recordInput(record.id))).toMatchObject({
      status: "refused",
      reason: "remote_refused",
      record: { state: "verified", failureCode: "rest_trash_not_supported" },
    });
  });

  it("goes uncertain on a lost answer, and a check finds what happened", async () => {
    const record = await sent();
    site.nextTrash = "lost_after_trash";
    expect(await service.trash(actor, recordInput(record.id))).toMatchObject({
      record: { state: "trash_uncertain" },
    });
    expect(
      await service.reconcile(actor, recordInput(record.id)),
    ).toMatchObject({ record: { state: "trashed", remoteStatus: "trash" } });
  });
});
