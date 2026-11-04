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

const approved = {
  eligible: true,
  value: {
    metadata: { title: "Title", slug: "title" },
    markdown: "Hello **world**",
    review: { requestId: "request", version: 2 },
  },
};

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
const recordInput = (recordId: string) => ({ projectId, recordId });
const stripMarker = (html: string) => html.replace(/<!--.*?-->/g, "");

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

describe(`a post that may be ours without our marker (${testDb.provider})`, () => {
  it("won't call a slug match without the marker absent, or send another", async () => {
    site.filterContent = stripMarker;
    site.nextCreate = "lost_after_insert";
    const record = await sent();
    await outOfWindow();
    expect(
      await service.reconcile(actor, recordInput(record.id)),
    ).toMatchObject({
      status: "refused",
      reason: "ambiguous_match",
      record: { state: "uncertain", remotePostId: null },
    });
    expect(await send()).toMatchObject({ reason: "not_ready" });
    expect(site.posts).toHaveLength(1);
    expect(site.creates).toBe(1);
  });

  it("does the same for a draft with no slug, by its exact title", async () => {
    eligibility.current.mockResolvedValue({
      ...approved,
      value: { ...approved.value, metadata: { title: "Title", slug: "" } },
    });
    site.filterContent = stripMarker;
    site.nextCreate = "lost_after_insert";
    const record = await sent();
    await outOfWindow();
    expect(
      await service.reconcile(actor, recordInput(record.id)),
    ).toMatchObject({
      reason: "ambiguous_match",
      record: { state: "uncertain" },
    });
    expect(site.creates).toBe(1);
  });

  it("won't retry a written-off attempt over a slug match without the marker", async () => {
    site.nextCreate = "lost_before_insert";
    const record = await sent();
    await outOfWindow();
    await service.reconcile(actor, recordInput(record.id));
    site.posts.push({
      id: 50,
      status: "draft",
      slug: "title",
      modified_gmt: "2026-01-01T00:00:00",
      title: { raw: "Title" },
      content: { raw: "<p>No marker</p>" },
    });
    expect(await send()).toMatchObject({
      status: "refused",
      reason: "ambiguous_match",
      record: { state: "not_found", attempt: 1 },
    });
    expect(site.creates).toBe(1);
    site.ownerDelete();
    expect(await sent()).toMatchObject({ state: "verified", attempt: 2 });
    expect(site.posts).toHaveLength(1);
  });

  it("won't call a full page of other results absent, since it may hide more", async () => {
    site.nextCreate = "lost_before_insert";
    const record = await sent();
    await outOfWindow();
    const other = {
      status: "draft",
      slug: "other",
      modified_gmt: "2026-01-01T00:00:00",
      title: { raw: "Other" },
      content: { raw: "<p>Other</p>" },
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: unknown, init?: RequestInit) =>
        new URL(String(url)).searchParams.has("search")
          ? Response.json(
              Array.from({ length: 20 }, (_, id) => ({ ...other, id: id + 1 })),
            )
          : site.fetch(url, init),
      ),
    );
    expect(
      await service.reconcile(actor, recordInput(record.id)),
    ).toMatchObject({
      reason: "ambiguous_match",
      record: { state: "uncertain" },
    });
  });

  it("adopts the marked post even when an unmarked one shares its slug", async () => {
    site.nextCreate = "lost_after_insert";
    const record = await sent();
    site.posts.unshift({
      id: 50,
      status: "publish",
      slug: "title",
      modified_gmt: "2026-01-01T00:00:00",
      title: { raw: "Older post" },
      content: { raw: "<p>Older</p>" },
    });
    expect(
      await service.reconcile(actor, recordInput(record.id)),
    ).toMatchObject({
      status: "recorded",
      record: { state: "verified", remotePostId: 100 },
    });
  });
});
