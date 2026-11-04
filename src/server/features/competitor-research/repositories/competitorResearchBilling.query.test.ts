import { afterAll, beforeEach, expect, it, vi } from "vitest";

const { testDb } = await vi.hoisted(async () => {
  const { createSiteAuthorityTestDb } =
    await import("../../site-authority/siteAuthorityTestDb");
  return { testDb: await createSiteAuthorityTestDb() };
});
vi.mock("cloudflare:workers", () => ({
  env: { DATABASE_PROVIDER: testDb.provider },
}));
vi.mock("@/db", () => ({ db: testDb.db }));
vi.mock("@/db/runBatch", () => ({ runBatch: testDb.runBatch }));
vi.mock("@/server/lib/runtime-env", () => ({
  usesBetterAuthServer: async () => true,
}));

import { CompetitorResearchRepository as repository } from "./CompetitorResearchRepository";

const actor = {
  userId: "user",
  userEmail: "authority@example.com",
  organizationId: "organization",
  role: "owner",
  surface: "web" as const,
};

beforeEach(testDb.seedProject);
afterAll(testDb.close);

async function claimed() {
  const { scope, snapshot } = await repository.getSnapshot(actor, "project");
  const id = crypto.randomUUID();
  const now = Date.now();
  expect(
    await repository.admit(scope, {
      id,
      input: {
        projectId: "project",
        requestId: crypto.randomUUID(),
        expectedContextVersion: snapshot.contextVersion,
        contextHash: snapshot.contextHash,
        capabilityFingerprint: "a".repeat(64),
        confirmedPaidWork: true,
      },
      requestHash: "b".repeat(64),
      snapshot,
      businessSummary: "Business",
      blockedReason: null,
      modelBackendId: "openrouter",
      modelConfigurationHash: "c".repeat(64),
      nowMs: now,
    }),
  ).toMatchObject({ kind: "created" });
  expect(
    await repository.prepareOperation(
      id,
      "search_0",
      {
        inputHash: "d".repeat(64),
        queryText: "Business alternatives",
        targetUrl: null,
      },
      now + 1,
    ),
  ).toEqual({ kind: "prepared" });
  const issued = await repository.issueOperation(
    id,
    "search_0",
    now + 2,
    "c".repeat(64),
  );
  if (issued.kind !== "issued") throw new Error("Search not issued");
  expect(
    await repository.recordSearch(
      id,
      "search_0",
      issued.issueToken,
      { billing: { path: ["serp"], costUsd: 0.02 }, organic: [] },
      now + 3,
    ),
  ).toEqual({ kind: "stored" });
  expect(await repository.finish(id, "complete", null, now + 4)).toEqual({
    kind: "finished",
  });
  const claim = await repository.claimBilling(id, now + 5);
  if (claim.kind !== "claimed") throw new Error("Billing not claimed");
  return { id, token: claim.billingToken };
}

it("reads only an already claimed billing context without current membership", async () => {
  const { id, token } = await claimed();
  const other = await claimed();
  await testDb.execute("delete from member where id='membership'");
  expect(await repository.getAuthority(id)).toBeNull();
  expect(await repository.getBillingContext(id, token)).toEqual({
    userId: actor.userId,
    userEmail: actor.userEmail,
    organizationId: actor.organizationId,
    projectId: "project",
  });
  expect(await repository.getBillingContext(id, other.token)).toBeNull();
  await repository.recordBilling(id, token, "unknown");
  expect(await repository.getBillingContext(id, token)).toBeNull();
});

it("retains the admitted billing context after project archive", async () => {
  const { id, token } = await claimed();
  await testDb.execute(
    "update projects set archived_at='2026-01-01' where id='project'",
  );
  expect(await repository.getAuthority(id)).toBeNull();
  expect(await repository.getBillingContext(id, token)).toMatchObject({
    organizationId: "organization",
    projectId: "project",
  });
});

it.each([
  [
    "erased run",
    "update project_competitor_research_runs set redacted_at_ms=1",
  ],
  ["deleted sponsor", "delete from \"user\" where id='user'"],
  [
    "foreign project",
    "update projects set organization_id='foreign' where id='project'",
  ],
])("rejects %s after the billing claim", async (_name, mutation) => {
  const { id, token } = await claimed();
  await testDb.execute(mutation);
  expect(await repository.getBillingContext(id, token)).toBeNull();
});
