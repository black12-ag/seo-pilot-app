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
import { WordPressConnectionService as connections } from "./WordPressConnectionService";
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
const input = (recordId: string) => ({ projectId, recordId });
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

describe(`the saved password (${testDb.provider})`, () => {
  const authorityRevoked =
    "update project_site_authority set status='revoked', verified_at_ms=null, verified_until_ms=null, current_challenge_id=null, revocation_reason='website_changed';";
  const denials = [
    ["a website change", authorityRevoked, "site_not_verified"],
    [
      "a lapsed verification",
      "update project_site_authority set verified_until_ms = 2;",
      "site_not_verified",
    ],
    [
      "both grants off",
      "update wordpress_connections set read_status='revoked', write_status='revoked';",
      "grant_missing",
    ],
    [
      "the read grant off",
      "update wordpress_connections set read_status='revoked';",
      "grant_missing",
    ],
  ] as const;

  it.each(denials)(
    "stays home on a check or a trash after %s",
    async (_label, change, reason) => {
      const record = await sent();
      await testDb.executeMultiple(change);
      site.authorization = null;
      expect(await service.reconcile(actor, input(record.id))).toMatchObject({
        status: "refused",
        reason,
      });
      expect(await service.trash(actor, input(record.id))).toMatchObject({
        status: "refused",
        reason,
      });
      expect(site.authorization).toBeNull();
      expect(site.posts[0]?.status).toBe("draft");
    },
  );

  it.each(denials)(
    "stays home on a retry's search after %s",
    async (_label, change, reason) => {
      site.nextCreate = "reject";
      await sent();
      const preview = await service.preview(actor, { projectId, contentId });
      if (preview.status !== "ready") throw new Error(preview.reason);
      await testDb.executeMultiple(change);
      site.authorization = null;
      const searches = site.searches;
      expect(
        await service.publish(actor, {
          projectId,
          contentId,
          revisionId: preview.revisionId,
          expectedHeadVersion: preview.headVersion,
          expectedContentHash: preview.contentHash,
        }),
      ).toMatchObject({ status: "refused", reason });
      expect(site.searches).toBe(searches);
      expect(site.authorization).toBeNull();
    },
  );

  it("stays sealed when the row is opened with another secret", async () => {
    const record = await sent();
    vi.stubEnv("BETTER_AUTH_SECRET", "y".repeat(40));
    site.authorization = null;
    expect(await service.reconcile(actor, input(record.id))).toMatchObject({
      status: "refused",
      reason: "credential_unreadable",
    });
    expect(site.authorization).toBeNull();
  });

  it("stays home on a trash when only the write grant is off", async () => {
    const record = await sent();
    await connections.revokeGrant(actor, { projectId, grant: "write" });
    site.authorization = null;
    expect(await service.trash(actor, input(record.id))).toMatchObject({
      status: "refused",
      reason: "grant_missing",
    });
    expect(site.authorization).toBeNull();
  });

  it("stays home on a grant check once the site isn't verified", async () => {
    await testDb.executeMultiple(authorityRevoked);
    site.authorization = null;
    expect(
      await connections.checkGrant(actor, { projectId, grant: "read" }),
    ).toMatchObject({ status: "refused", reason: "site_not_verified" });
    expect(site.authorization).toBeNull();
    expect(site.userReads).toBe(0);
  });

  it("isn't sent to read back a write once authority goes during the write", async () => {
    site.whenRequest(
      (_url, method) => method === "POST",
      async () => {
        await testDb.executeMultiple(authorityRevoked);
        site.authorization = null;
      },
    );
    expect(await sent()).toMatchObject({
      state: "uncertain",
      remotePostId: site.posts[0]?.id,
    });
    expect(site.creates).toBe(1);
    expect(site.authorization).toBeNull();
  });
});

describe(`approval during a retry (${testDb.provider})`, () => {
  beforeEach(async () => {
    site.nextCreate = "reject";
    await sent();
  });

  it("sends nothing when the eligibility check after the search says no", async () => {
    site.whenRequest(markerSearch, async () => {
      eligibility.current.mockResolvedValue({
        eligible: false,
        reason: "approval_withdrawn",
      });
    });
    const preview = await service.preview(actor, { projectId, contentId });
    if (preview.status !== "ready") throw new Error(preview.reason);
    expect(
      await service.publish(actor, {
        projectId,
        contentId,
        revisionId: preview.revisionId,
        expectedHeadVersion: preview.headVersion,
        expectedContentHash: preview.contentHash,
      }),
    ).toMatchObject({
      status: "refused",
      reason: "approval_withdrawn",
      record: { state: "failed", attempt: 1 },
    });
    expect(site.creates).toBe(1);
    expect(site.posts).toHaveLength(0);
  });

  it("sends nothing when approval goes after that check, because the claim re-reads it", async () => {
    site.whenRequest(markerSearch, () =>
      testDb.executeMultiple(
        "update content_review_requests set state = 'withdrawn', version = 3;",
      ),
    );
    expect(await send()).toMatchObject({
      status: "refused",
      reason: "not_ready",
      record: { state: "failed", attempt: 1 },
    });
    expect(site.creates).toBe(1);
    expect(site.posts).toHaveLength(0);
  });
});
