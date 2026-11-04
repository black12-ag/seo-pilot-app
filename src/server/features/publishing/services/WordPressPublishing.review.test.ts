import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const { testDb } = await vi.hoisted(async () => {
  const { createSiteAuthorityTestDb } =
    await import("@/server/features/site-authority/siteAuthorityTestDb");
  return { testDb: await createSiteAuthorityTestDb() };
});
vi.mock("cloudflare:workers", () => ({
  env: { DATABASE_PROVIDER: testDb.provider },
  waitUntil: () => undefined,
}));
vi.mock("@/db", () => ({ db: testDb.db }));
vi.mock("@/db/runBatch", () => ({ runBatch: testDb.runBatch }));
vi.mock("@/server/lib/runtime-env", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  usesBetterAuthServer: async () => true,
  getWorkersEnv: async () => ({}),
  getOptionalEnvValue: async (name: string) =>
    name === "BETTER_AUTH_SECRET" ? "x".repeat(40) : undefined,
}));
import { ContentReviewService } from "@/server/features/content/services/ContentReviewService";
import { ContentService } from "@/server/features/content/services/ContentService";
import {
  actor,
  fixture,
} from "@/server/features/content/contentDraftTestFixture";
import {
  grantedConnectionSql,
  publishingOrigin as origin,
  verifiedAuthoritySql,
} from "../publishingTestDb";
import { WordPressPublishingService as publishing } from "./WordPressPublishingService";
import { sealWordPressCredential } from "./wordpressCredential";
import { fakeWordPress, type FakeWordPress } from "./fakeWordPress";

const projectId = "project";

beforeEach(testDb.seedProject);
afterAll(testDb.close);

/** A revision taken through a real review, ready to send to the fake site. */
async function approvedDraft() {
  const { request } = await fixture();
  const { contentId } = request;
  const head = await ContentService.getRevision(actor, {
    projectId,
    contentId,
  });
  const saved = await ContentService.saveRevision(actor, {
    projectId,
    contentId,
    mutationId: crypto.randomUUID(),
    expectedHeadVersion: head.revision.version,
    expectedContextVersion: head.revision.contextVersion,
    brief: head.revision.brief,
    markdown: "Approved text",
    metadata: { ...head.revision.metadata, title: "Title", slug: "title" },
    sourceIds: head.revision.sourceIds,
    claims: [],
    openQuestions: [],
    omissions: [],
  });
  if (!saved.ok) throw new Error("Not saved");
  const read = await ContentService.getRevision(actor, {
    projectId,
    contentId,
  });
  const review = await ContentReviewService.request(actor, {
    projectId,
    contentId,
    revisionId: read.revision.id,
    mutationId: crypto.randomUUID(),
    expectedHeadVersion: read.revision.version,
    expectedContextVersion: read.revision.contextVersion,
    checkSetId: read.checks.id,
    assigneeUserId: actor.userId,
  });
  const decided = await ContentReviewService.decide(actor, {
    projectId,
    contentId,
    requestId: review.id,
    mutationId: crypto.randomUUID(),
    expectedRequestVersion: review.version,
    expectedHeadVersion: read.revision.version,
    decision: "approve",
    claimAssessments: [],
    assessedRemainingText: true,
    reason: "",
  });
  expect(decided.state).toBe("approved");
  const sealed = await sealWordPressCredential({
    username: "editor",
    applicationPassword: "abcd efgh ijkl mnop qrst uvwx",
    projectId,
    origin,
  });
  await testDb.executeMultiple(
    verifiedAuthoritySql() + grantedConnectionSql(sealed),
  );
  const withdraw = () =>
    ContentReviewService.withdraw(actor, {
      projectId,
      contentId,
      requestId: decided.id,
      mutationId: crypto.randomUUID(),
      expectedRequestVersion: decided.version,
      expectedHeadVersion: read.revision.version,
      reason: "Stop",
    });
  return { contentId, withdraw };
}

async function sendInput(contentId: string) {
  const preview = await publishing.preview(actor, { projectId, contentId });
  if (preview.status !== "ready") throw new Error(preview.reason);
  return {
    projectId,
    contentId,
    revisionId: preview.revisionId,
    expectedHeadVersion: preview.headVersion,
    expectedContentHash: preview.contentHash,
  };
}

describe(`a real review and a real send (${testDb.provider})`, () => {
  let site: FakeWordPress;
  beforeEach(() => {
    site = fakeWordPress(origin);
    vi.stubGlobal("fetch", vi.fn(site.fetch));
    return () => void vi.unstubAllGlobals();
  });

  it("sends a draft under an approval the write statement can see", async () => {
    const { contentId } = await approvedDraft();
    expect(
      await publishing.publish(actor, await sendInput(contentId)),
    ).toMatchObject({ status: "recorded", record: { state: "verified" } });
    expect(site.posts).toHaveLength(1);
  });

  it("stops a retry when the approval is withdrawn during its search", async () => {
    const { contentId, withdraw } = await approvedDraft();
    const input = await sendInput(contentId);
    site.nextCreate = "reject";
    expect(await publishing.publish(actor, input)).toMatchObject({
      record: { state: "failed" },
    });
    let withdrew = false;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: unknown, init?: RequestInit) => {
        if (!withdrew && new URL(String(url)).searchParams.has("search")) {
          withdrew = true;
          await withdraw();
        }
        return site.fetch(url, init);
      }),
    );
    expect(await publishing.publish(actor, input)).toMatchObject({
      status: "refused",
      reason: "approval_withdrawn",
      record: { state: "failed", attempt: 1 },
    });
    expect(withdrew).toBe(true);
    expect(site.posts).toHaveLength(0);
    expect(site.creates).toBe(1);
  });
});
