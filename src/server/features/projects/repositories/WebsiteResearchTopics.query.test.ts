import { afterAll, beforeEach, expect, it, vi } from "vitest";

const { testDb } = await vi.hoisted(async () => {
  const { createSiteAuthorityTestDb } =
    await import("../../site-authority/siteAuthorityTestDb");
  return { testDb: await createSiteAuthorityTestDb() };
});
vi.mock("cloudflare:workers", () => ({
  env: { DATABASE_PROVIDER: testDb.provider },
}));
// Seeded tracking uses DataForSEO's default engine here.
vi.mock(
  "@/server/features/ai-visibility/services/aiVisibilityProviders",
  async (importOriginal) => ({
    ...(await importOriginal<object>()),
    defaultAiEngine: async () => "chatgpt",
  }),
);
vi.mock("@/db", () => ({ db: testDb.db }));
vi.mock("@/db/runBatch", () => ({ runBatch: testDb.runBatch }));
vi.mock("@/server/lib/runtime-env", () => ({
  usesBetterAuthServer: async () => true,
}));

import { WebsiteResearchAttemptRepository as repo } from "./WebsiteResearchAttemptRepository";
import { setup, review } from "./websiteResearchAttemptTestDb";
import { prepareWebsiteTracking } from "@/server/features/ai-visibility/services/websiteTrackingSetup";

beforeEach(async () => {
  await testDb.seedProject();
  await testDb.execute(
    "insert into project_context_sections (project_id,key,content,updated_by) values ('project','business_overview','Saved overview','user')",
  );
  await testDb.execute(
    "insert into project_competitors (id,project_id,domain,name,updated_by) values ('competitor','project','rival.com','Rival','user')",
  );
});
afterAll(testDb.close);

async function running() {
  const { scope, input } = await setup({ mode: "ai_setup" });
  const admitted = await repo.admit(scope, input);
  if (admitted.kind !== "created") throw new Error("expected admission");
  const claim = await repo.claimExecution(
    scope,
    input.id,
    admitted.admissionToken,
    1001,
  );
  if (claim.kind !== "claimed") throw new Error("expected claim");
  return {
    scope,
    input: {
      attemptId: input.id,
      admissionToken: admitted.admissionToken,
      executionToken: claim.executionToken,
      review: { ...review, competitors: [], preserveCompetitors: true },
      tracking: null,
      nowMs: 1002,
    },
  };
}

it("atomically writes topics once and closes the winning attempt", async () => {
  const { scope, input } = await running();
  const [a, b] = await Promise.all([
    repo.completeTopics(scope, input),
    repo.completeTopics(scope, input),
  ]);
  expect(new Set([a.kind, b.kind])).toEqual(
    new Set(["already_finished", "applied"]),
  );
  const row = await repo.get(scope, "project", input.attemptId);
  expect(row.state).toBe("finished_no_review");
  expect(row.executionToken).not.toBe(input.executionToken);
  const project = await testDb.execute(
    "select ai_research_keywords from projects where id='project'",
  );
  expect(project[0].ai_research_keywords).toContain("Search topic");
  expect(
    await testDb.execute("select id from project_competitor_research_runs"),
  ).toHaveLength(0);
});

it.each([
  ["role", "update member set role='admin' where id='membership'"],
  ["domain", "update projects set domain='other.com' where id='project'"],
  ["market", "update projects set location_code=2841 where id='project'"],
  [
    "archive",
    "update projects set archived_at='2026-01-01' where id='project'",
  ],
  [
    "context",
    "insert into content_project_state (project_id,context_version,updated_at_ms) values ('project',1,1002)",
  ],
  [
    "keywords",
    "update projects set ai_research_keywords='other' where id='project'",
  ],
])("blocks %s drift without a keyword write", async (_name, mutation) => {
  const { scope, input } = await running();
  await testDb.execute(mutation);
  const before = await testDb.execute(
    "select ai_research_keywords from projects where id='project'",
  );
  expect((await repo.completeTopics(scope, input)).kind).toBe("blocked");
  const after = await testDb.execute(
    "select ai_research_keywords from projects where id='project'",
  );
  expect(after).toEqual(before);
  const rows = await testDb.execute(
    `select state from project_website_research_attempts where id='${input.attemptId}'`,
  );
  expect(rows[0].state).toBe("running");
});

it("rejects replacement membership, deadline and competing tracker", async () => {
  const { scope, input } = await running();
  expect(
    (await repo.completeTopics(scope, { ...input, nowMs: 301000 })).kind,
  ).toBe("blocked");
  const tracking = await prepareWebsiteTracking(
    { projectId: "project", suggestedTopics: input.review.suggestedTopics },
    { locationCode: 2840, languageCode: "en" },
  );
  if (!tracking) throw new Error("expected tracker draft");
  await testDb.execute(
    "insert into ai_trackers (id,project_id,created_at) values ('other','project','2026-01-01')",
  );
  expect((await repo.completeTopics(scope, { ...input, tracking })).kind).toBe(
    "blocked",
  );
  await testDb.execute("delete from ai_trackers where id='other'");
  await testDb.execute("delete from member where id='membership'");
  await testDb.execute(
    `insert into member (id,organization_id,user_id,role,created_at) values ('replacement','organization','user','owner',${testDb.pg ? "now()" : "0"})`,
  );
  expect((await repo.completeTopics(scope, { ...input, tracking })).kind).toBe(
    "blocked",
  );
  expect(
    await testDb.execute(
      "select ai_research_keywords from projects where id='project'",
    ),
  ).toMatchObject([{ ai_research_keywords: null }]);
});

it.each([5, 6])(
  "rolls back terminal receipt when statement %i fails",
  async (index) => {
    const { scope, input } = await running();
    testDb.failNextBatchAt(index);
    await expect(repo.completeTopics(scope, input)).rejects.toThrow();
    expect((await repo.get(scope, "project", input.attemptId)).state).toBe(
      "running",
    );
    const project = await testDb.execute(
      "select ai_research_keywords from projects where id='project'",
    );
    expect(project[0].ai_research_keywords).toBeNull();
  },
);

it("rolls back keywords when membership changes after the receipt claim", async () => {
  const { scope, input } = await running();
  testDb.mutateMembershipInNextBatchAt(6, "admin");
  await expect(repo.completeTopics(scope, input)).rejects.toThrow();
  expect((await repo.get(scope, "project", input.attemptId)).state).toBe(
    "running",
  );
  const project = await testDb.execute(
    "select ai_research_keywords from projects where id='project'",
  );
  expect(project[0].ai_research_keywords).toBeNull();
});
