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
  heldApproval,
  publishingOrigin as origin,
  verifiedAuthoritySql,
} from "../publishingTestDb";
import { WordPressPublishingService as service } from "./WordPressPublishingService";
import { sealWordPressCredential } from "./wordpressCredential";
import { fakeWordPress, type FakeWordPress } from "./fakeWordPress";

const actor = {
  userId: "user",
  organizationId: "organization",
  role: "owner",
  surface: "web" as const,
};
const projectId = "project";
const contentId = "content";
let site: FakeWordPress;

const approvedWith = (title: string, markdown = "Hello **world**") => ({
  eligible: true,
  value: {
    metadata: { title, slug: "title" },
    markdown,
    review: {
      requestId: heldApproval.requestId,
      version: heldApproval.requestVersion,
    },
  },
});

async function send() {
  const preview = await service.preview(actor, { projectId, contentId });
  if (preview.status !== "ready") throw new Error(preview.reason);
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
const input = (recordId: string) => ({ projectId, recordId });
const storedRecord = async () =>
  (
    await testDb.execute(
      "select state, attempt, remote_post_id, remote_content_hash, remote_modified_gmt from wordpress_publish_records",
    )
  )[0];

const markerSearch = (url: URL) => url.searchParams.has("search");

beforeEach(async () => {
  vi.stubEnv("BETTER_AUTH_SECRET", "x".repeat(40));
  vi.stubEnv("AUTH_MODE", "password");
  site = fakeWordPress(origin);
  vi.stubGlobal("fetch", vi.fn(site.fetch));
  eligibility.current.mockReset();
  eligibility.current.mockResolvedValue(approvedWith("Title"));
  await testDb.seedProject();
  await ContentRepository.createRevision(contentTestScope, contentTestWrite);
  const sealed = await sealWordPressCredential({
    username: "editor",
    applicationPassword: "abcd efgh ijkl mnop qrst uvwx",
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

describe(`the trash baseline (${testDb.provider})`, () => {
  it("won't trash an owner's edit made before our first read back", async () => {
    site.nextCreate = "lost_after_insert";
    const record = await sent();
    site.ownerEdit();
    expect(await service.reconcile(actor, input(record.id))).toMatchObject({
      record: { state: "mismatch", mismatchFields: ["content"] },
    });
    expect(await storedRecord()).toMatchObject({
      remote_content_hash: null,
      remote_modified_gmt: null,
    });
    site.authorization = null;
    expect(await service.trash(actor, input(record.id))).toMatchObject({
      status: "refused",
      reason: "baseline_missing",
    });
    expect(site.authorization).toBeNull();
    expect(site.trashes).toBe(0);
    expect(site.posts[0]?.status).toBe("draft");
  });

  it("won't trust a stored baseline that isn't what we sent", async () => {
    const record = await sent();
    await testDb.executeMultiple(
      "update wordpress_publish_records set remote_content_hash = 'other';",
    );
    expect(await service.trash(actor, input(record.id))).toMatchObject({
      status: "refused",
      reason: "baseline_missing",
    });
    expect(site.trashes).toBe(0);
  });

  describe("an edit within the same timestamp second", () => {
    const edits = [
      [
        "title",
        () => {
          if (site.posts[0]) site.posts[0].title.raw = "Owner's title";
        },
      ],
      [
        "slug",
        () => {
          if (site.posts[0]) site.posts[0].slug = "owners-slug";
        },
      ],
      [
        "revision",
        () => {
          site.latestRevision = 901;
        },
      ],
      [
        "revision list, now empty",
        () => {
          site.latestRevision = null;
        },
      ],
    ] as const;

    it.each(edits)("won't trash a changed %s", async (_field, edit) => {
      const record = await sent();
      edit();
      expect(await service.trash(actor, input(record.id))).toMatchObject({
        status: "refused",
        reason: "owner_edited",
      });
      expect(site.trashes).toBe(0);
      expect(site.posts[0]?.status).toBe("draft");
    });

    it("won't trash a first revision on a post that had none", async () => {
      site.latestRevision = null;
      const record = await sent();
      site.latestRevision = 901;
      expect(await service.trash(actor, input(record.id))).toMatchObject({
        status: "refused",
        reason: "owner_edited",
      });
      expect(site.trashes).toBe(0);
    });

    it("trashes an untouched draft on a site that keeps no revisions", async () => {
      site.latestRevision = null;
      const record = await sent();
      expect(await service.trash(actor, input(record.id))).toMatchObject({
        status: "recorded",
        record: { state: "trashed" },
      });
    });
  });

  it("won't trash when the baseline has no modified time to compare", async () => {
    const record = await sent();
    await testDb.executeMultiple(
      "update wordpress_publish_records set remote_modified_gmt = null;",
    );
    expect(await service.trash(actor, input(record.id))).toMatchObject({
      status: "refused",
      reason: "owner_edited",
    });
    expect(site.trashes).toBe(0);
  });

  it("records the baseline once a read back does match", async () => {
    site.filterContent = (html) => html.replace("world", "edited");
    const record = await sent();
    expect(record.state).toBe("mismatch");
    const stored = site.posts[0];
    if (!stored) throw new Error("No post");
    stored.content.raw = stored.content.raw.replace("edited", "world");
    expect(await service.reconcile(actor, input(record.id))).toMatchObject({
      record: { state: "verified" },
    });
    expect(await service.trash(actor, input(record.id))).toMatchObject({
      status: "recorded",
      record: { state: "trashed" },
    });
  });

  it("still won't resend a post that was read back and then removed", async () => {
    site.filterContent = (html) => html.replace("world", "edited");
    const record = await sent();
    site.ownerDelete();
    expect(await service.reconcile(actor, input(record.id))).toMatchObject({
      record: { state: "mismatch", mismatchFields: ["missing"] },
    });
    expect((await sent()).state).toBe("mismatch");
    expect(site.creates).toBe(1);
  });

  const erase =
    "update wordpress_publish_records set title = '', slug = '', content_hash = '', remote_content_hash = null, mismatch_fields = null;";

  it("refuses to check or trash an erased record, and it gains nothing back", async () => {
    const record = await sent();
    await testDb.executeMultiple(erase);
    site.authorization = null;
    expect(await service.reconcile(actor, input(record.id))).toMatchObject({
      status: "refused",
      reason: "record_erased",
    });
    expect(await service.trash(actor, input(record.id))).toMatchObject({
      status: "refused",
      reason: "record_erased",
    });
    expect(site.authorization).toBeNull();
    expect(await storedRecord()).toMatchObject({ remote_content_hash: null });
    expect(site.posts[0]?.status).toBe("draft");
  });

  it("drops the baseline when erasure lands during the first read back", async () => {
    site.nextCreate = "lost_after_insert";
    const record = await sent();
    site.whenRequest(markerSearch, () => testDb.executeMultiple(erase));
    await service.reconcile(actor, input(record.id));
    expect(await storedRecord()).toMatchObject({ remote_content_hash: null });
    expect(await service.trash(actor, input(record.id))).toMatchObject({
      status: "refused",
      reason: "record_erased",
    });
    expect(site.posts[0]?.status).toBe("draft");
  });
});

describe(`a stored title (${testDb.provider})`, () => {
  it("reaches WordPress as text, reads back clean, and stays readable here", async () => {
    const title = `<img src=x onerror=alert(1)>Fish & "chips"`;
    eligibility.current.mockResolvedValue(approvedWith(title));
    expect(await sent()).toMatchObject({ state: "verified", title });
    expect(site.posts[0]?.title.raw).toBe(
      `&lt;img src=x onerror=alert(1)&gt;Fish &amp; "chips"`,
    );
  });

  it("does the same on a retry", async () => {
    eligibility.current.mockResolvedValue(approvedWith("<b>Bold</b>"));
    site.nextCreate = "reject";
    await sent();
    expect(await sent()).toMatchObject({ state: "verified", attempt: 2 });
    expect(site.posts[0]?.title.raw).toBe("&lt;b&gt;Bold&lt;/b&gt;");
  });
});

describe(`a slow check (${testDb.provider})`, () => {
  it("can't overwrite a newer attempt and open the way to a double post", async () => {
    site.nextCreate = "lost_before_insert";
    const record = await sent();
    await outOfWindow();
    site.whenRequest(markerSearch, async () => {
      await service.reconcile(actor, input(record.id));
      site.nextCreate = "lost_before_insert";
      expect(await sent()).toMatchObject({ state: "uncertain", attempt: 2 });
    });
    expect(await service.reconcile(actor, input(record.id))).toMatchObject({
      record: { state: "uncertain", attempt: 2 },
    });
    expect(await send()).toMatchObject({
      status: "refused",
      reason: "not_ready",
    });
    expect(site.creates).toBe(2);
  });
});

describe(`a 404 from something other than WordPress (${testDb.provider})`, () => {
  it("leaves an uncertain trash uncertain until WordPress itself says it's gone", async () => {
    const record = await sent();
    site.nextTrash = "lost_after_trash";
    await service.trash(actor, input(record.id));
    site.firewallNotFound = true;
    expect(await service.reconcile(actor, input(record.id))).toMatchObject({
      status: "refused",
      reason: "check_failed",
      record: { state: "trash_uncertain" },
    });
    site.firewallNotFound = false;
    site.ownerDelete();
    expect(await service.reconcile(actor, input(record.id))).toMatchObject({
      record: { state: "trashed", remoteStatus: "missing" },
    });
  });

  it("leaves an uncertain draft uncertain, so it can't be sent again", async () => {
    site.failReads = true;
    const record = await sent();
    expect(record).toMatchObject({ state: "uncertain" });
    site.failReads = false;
    site.firewallNotFound = true;
    expect(await service.reconcile(actor, input(record.id))).toMatchObject({
      status: "refused",
      reason: "check_failed",
      record: { state: "uncertain", remotePostId: record.remotePostId },
    });
    expect(await send()).toMatchObject({ reason: "not_ready" });
    expect(site.creates).toBe(1);
  });

  it("doesn't call a post missing before a trash", async () => {
    const record = await sent();
    site.firewallNotFound = true;
    expect(await service.trash(actor, input(record.id))).toMatchObject({
      status: "refused",
      reason: "check_failed",
    });
  });
});

describe(`a proxy that times out (${testDb.provider})`, () => {
  it("leaves the record uncertain, and the post is found rather than resent", async () => {
    site.nextCreate = "proxy_timeout_after_insert";
    const record = await sent();
    expect(record.state).toBe("uncertain");
    expect(await send()).toMatchObject({ reason: "not_ready" });
    expect(await service.reconcile(actor, input(record.id))).toMatchObject({
      record: { state: "verified" },
    });
    expect(site.creates).toBe(1);
  });
});
