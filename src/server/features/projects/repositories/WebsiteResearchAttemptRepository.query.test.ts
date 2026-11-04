import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
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
  usesBetterAuthServer: () => Promise.resolve(true),
}));
import { CompetitorResearchRepository } from "@/server/features/competitor-research/repositories/CompetitorResearchRepository";
import { WebsiteResearchAttemptRepository as repository } from "./WebsiteResearchAttemptRepository";

beforeEach(testDb.seedProject);
afterAll(testDb.close);

import {
  actor,
  setup,
  review,
  setupRunInput,
} from "./websiteResearchAttemptTestDb";

it("admits once, preserves replay, and keeps one active project slot", async () => {
  const { scope, input } = await setup();
  const [first, second] = await Promise.all([
    repository.admit(scope, input),
    repository.admit(scope, input),
  ]);
  expect(new Set([first.kind, second.kind])).toEqual(
    new Set(["created", "replayed"]),
  );
  expect(
    await repository.admit(scope, { ...input, id: crypto.randomUUID() }),
  ).toMatchObject({ kind: "busy" });
  expect(
    await repository.admit(scope, { ...input, requestedWebsite: "other.com" }),
  ).toMatchObject({ kind: "conflict" });
  expect(
    await repository.admit(scope, { ...input, mode: "ai_setup" }),
  ).toMatchObject({ kind: "conflict" });
  expect(
    await repository.admit(
      { ...scope, actor: { ...actor, surface: "mcp" } },
      { ...input },
    ),
  ).toMatchObject({ kind: "conflict" });
  await testDb.executeMultiple(
    `insert into "user" (id,name,email,created_at,updated_at) values ('other-user','Other','other@example.com',${testDb.pg ? "now(),now()" : "0,0"}); insert into member (id,organization_id,user_id,role,created_at) values ('other-member','organization','other-user','owner',${testDb.pg ? "now()" : "0"});`,
  );
  const { scope: other } = await CompetitorResearchRepository.getSnapshot(
    { ...actor, userId: "other-user", userEmail: "other@example.com" },
    "project",
  );
  expect((await repository.admit(other, input)).kind).toBe("conflict");
});

it("claims one executor and stores an immutable complete review", async () => {
  const { scope, input } = await setup();
  const admitted = await repository.admit(scope, input);
  if (admitted.kind !== "created") throw new Error("expected winner");
  expect(
    await repository.claimExecution(scope, input.id, "wrong", 1001),
  ).toMatchObject({ kind: "blocked" });
  const [first, second] = await Promise.all([
    repository.claimExecution(scope, input.id, admitted.admissionToken, 1001),
    repository.claimExecution(scope, input.id, admitted.admissionToken, 1001),
  ]);
  expect(new Set([first.kind, second.kind])).toEqual(
    new Set(["blocked", "claimed"]),
  );
  const claimed = first.kind === "claimed" ? first : second;
  if (claimed.kind !== "claimed") throw new Error("expected one executor");
  expect(
    await repository.complete(
      scope,
      input.id,
      claimed.executionToken,
      review,
      1002,
    ),
  ).toMatchObject({ kind: "stored" });
  expect(
    await repository.complete(
      scope,
      input.id,
      claimed.executionToken,
      review,
      1003,
    ),
  ).toMatchObject({ kind: "replayed" });
  expect(
    await repository.complete(
      scope,
      input.id,
      claimed.executionToken,
      { ...review, overview: "Changed" },
      1004,
    ),
  ).toMatchObject({ kind: "conflict" });
  const row = await repository.get(scope, "project", input.id);
  expect(JSON.parse(row.reviewSnapshotJson!)).toEqual(review);
  expect(row.state).toBe("review_ready");
  expect(
    await repository.finish(
      input.id,
      { executionToken: claimed.executionToken },
      "failed",
      "late",
      1005,
    ),
  ).toMatchObject({ kind: "blocked" });
});

it("refuses malformed, oversized and wrong-domain reviews before storage", async () => {
  const { scope, input } = await setup();
  const admitted = await repository.admit(scope, input);
  if (admitted.kind !== "created") throw new Error("expected winner");
  const claimed = await repository.claimExecution(
    scope,
    input.id,
    admitted.admissionToken,
    1001,
  );
  if (claimed.kind !== "claimed") throw new Error("expected executor");
  await expect(
    repository.complete(
      scope,
      input.id,
      claimed.executionToken,
      { ...review, domain: "other.com" },
      1002,
    ),
  ).rejects.toThrow();
  await expect(
    repository.complete(
      scope,
      input.id,
      claimed.executionToken,
      { ...review, overview: "x".repeat(70000) },
      1002,
    ),
  ).rejects.toThrow();
  await expect(
    repository.complete(
      scope,
      input.id,
      claimed.executionToken,
      { ...review, suggestedTopics: [{ name: "bad", prompts: [] }] },
      1002,
    ),
  ).rejects.toThrow();
  expect((await repository.get(scope, "project", input.id)).state).toBe(
    "running",
  );
});

it("keeps requested domain separate when project domain is initially null", async () => {
  await testDb.execute("update projects set domain=null where id='project'");
  const { scope, input } = await setup();
  const admitted = await repository.admit(scope, input);
  expect(admitted.kind).toBe("created");
  const row = await repository.get(scope, "project", input.id);
  expect(row.snapshotDomain).toBeNull();
  expect(row.requestedDomain).toBe("example.com");
  expect(row.requestedWebsite).toBe("https://example.com/start");
});

it("releases a prelaunch AI attempt only with its admission proof", async () => {
  const { scope, input } = await setup({ mode: "ai_setup" });
  const admitted = await repository.admit(scope, input);
  if (admitted.kind !== "created") throw new Error("expected winner");
  expect(
    await repository.finish(
      input.id,
      { executionToken: "wrong" },
      "failed",
      "launch_unconfirmed",
      1001,
    ),
  ).toMatchObject({ kind: "blocked" });
  expect(
    await repository.finish(
      input.id,
      { admissionToken: admitted.admissionToken },
      "failed",
      "launch_unconfirmed",
      1001,
    ),
  ).toMatchObject({ kind: "finished" });
  expect(
    await repository.claimExecution(
      scope,
      input.id,
      admitted.admissionToken,
      1002,
    ),
  ).toMatchObject({ kind: "blocked" });
  expect(await repository.admit(scope, input)).toMatchObject({
    kind: "replayed",
  });
  expect(await repository.getLatestAi(scope, "project")).toMatchObject({
    state: "failed",
  });
});

it("releases a running attempt after member loss and never revives it", async () => {
  const { scope, input } = await setup();
  const admitted = await repository.admit(scope, input);
  if (admitted.kind !== "created") throw new Error("expected winner");
  const claimed = await repository.claimExecution(
    scope,
    input.id,
    admitted.admissionToken,
    1001,
  );
  if (claimed.kind !== "claimed") throw new Error("expected executor");
  await testDb.execute("delete from member where id='membership'");
  await testDb.execute(
    `insert into member (id,organization_id,user_id,role,created_at) values ('replacement','organization','user','owner',${testDb.pg ? "now()" : "0"})`,
  );
  expect(await repository.getAuthority(input.id, 1002)).toBeNull();
  expect(
    await repository.finish(
      input.id,
      { admissionToken: admitted.admissionToken },
      "unknown",
      "deadline",
      1002,
    ),
  ).toMatchObject({ kind: "blocked" });
  expect(
    await repository.finish(
      input.id,
      { executionToken: claimed.executionToken },
      "unknown",
      "deadline",
      1002,
    ),
  ).toMatchObject({ kind: "finished" });
  expect(await repository.getAuthority(input.id, 1003)).toBeNull();
  await expect(
    repository.claimExecution(scope, input.id, admitted.admissionToken, 1003),
  ).rejects.toThrow();
});

it("fences role, domain, context, archive and deadline from background authority", async () => {
  const { scope, input } = await setup();
  const admitted = await repository.admit(scope, input);
  if (admitted.kind !== "created") throw new Error("expected winner");
  expect(await repository.getAuthority(input.id, 301000)).toBeNull();
  await testDb.execute("update member set role='admin' where id='membership'");
  expect(await repository.getAuthority(input.id, 1001)).toBeNull();
  await testDb.execute("update member set role='owner' where id='membership'");
  await testDb.execute(
    "update projects set domain='changed.com' where id='project'",
  );
  expect(await repository.getAuthority(input.id, 1001)).toBeNull();
  await testDb.execute(
    "update projects set domain='example.com' where id='project'",
  );
  await testDb.execute(
    "insert into content_project_state (project_id,context_version,updated_at_ms) values ('project',1,1001)",
  );
  expect(await repository.getAuthority(input.id, 1001)).toBeNull();
  expect((await repository.get(scope, "project", input.id)).id).toBe(input.id);
  await testDb.execute(
    "delete from content_project_state where project_id='project'",
  );
  await testDb.execute(
    "update projects set archived_at='2026-01-01' where id='project'",
  );
  expect(await repository.getAuthority(input.id, 1001)).toBeNull();
  await expect(
    repository.claimExecution(scope, input.id, admitted.admissionToken, 1001),
  ).rejects.toThrow();
});

it("returns privacy_erased before comparing scrubbed request hash", async () => {
  const { scope, input } = await setup();
  await repository.admit(scope, input);
  await testDb.execute(
    `update project_website_research_attempts set redacted_at_ms=1001,request_hash=null,requested_website=null,requested_domain=null,sponsor_user_id=null,sponsor_member_id=null,sponsor_role=null,active_project_id=null,state='unknown',finished_at_ms=1001 where id='${input.id}'`,
  );
  expect(
    await repository.admit(scope, {
      ...input,
      requestedWebsite: "changed.com",
    }),
  ).toMatchObject({ kind: "privacy_erased" });
});
it("keeps restored history inert before hash comparison", async () => {
  const { scope, input } = await setup();
  const admitted = await repository.admit(scope, input);
  if (admitted.kind !== "created") throw new Error("expected winner");
  await testDb.execute(
    `update project_website_research_attempts set state='failed',active_project_id=null,finished_at_ms=1001,reason='restored',request_hash=null,sponsor_user_id=null,sponsor_member_id=null,sponsor_role=null where id='${input.id}'`,
  );
  expect(await repository.admit(scope, input)).toMatchObject({
    kind: "conflict",
  });
  expect(await repository.getAuthority(input.id, 1002)).toBeNull();
  expect(
    await repository.finish(
      input.id,
      { admissionToken: admitted.admissionToken },
      "failed",
      "late",
      1002,
    ),
  ).toMatchObject({ kind: "blocked" });
});

it("links only the original matching setup run before provider work", async () => {
  const { scope, input } = await setup();
  const admitted = await repository.admit(scope, input);
  if (admitted.kind !== "created") throw new Error("expected winner");
  const claimed = await repository.claimExecution(
    scope,
    input.id,
    admitted.admissionToken,
    1001,
  );
  if (claimed.kind !== "claimed") throw new Error("expected executor");
  const run = setupRunInput(input);
  const runId = run.id;
  expect(
    await CompetitorResearchRepository.admitSetup(scope, run),
  ).toMatchObject({ kind: "created" });
  expect(
    await repository.linkCompetitorRun(
      scope,
      input.id,
      claimed.executionToken,
      runId,
      1002,
    ),
  ).toMatchObject({ kind: "blocked" });
  await testDb.execute(
    `update project_competitor_research_runs set project_id='foreign-project',organization_id='foreign',active_project_id='foreign-project' where id='${runId}'`,
  );
  expect(
    (
      await repository.linkCompetitorRun(
        scope,
        input.id,
        claimed.executionToken,
        runId,
        1002,
      )
    ).kind,
  ).toBe("blocked");
  await testDb.execute(
    `update project_competitor_research_runs set project_id='project',organization_id='organization',active_project_id='project',request_id='${input.id}' where id='${runId}'`,
  );
  expect(
    await repository.linkCompetitorRun(
      scope,
      input.id,
      claimed.executionToken,
      runId,
      1002,
    ),
  ).toMatchObject({ kind: "linked" });
  expect(
    (await repository.get(scope, "project", input.id)).competitorRunId,
  ).toBe(runId);
});
describe("migration and atomic guards", () => {
  it("enforces the review snapshot's UTF-8 byte limit in SQL", async () => {
    const { scope, input } = await setup();
    await repository.admit(scope, input);
    const oversized = "🙂".repeat(17000);
    await expect(
      testDb.execute(
        `update project_website_research_attempts set state='review_ready',active_project_id=null,finished_at_ms=1001,review_snapshot_json='${oversized}',review_hash='hash' where id='${input.id}'`,
      ),
    ).rejects.toThrow();
    expect((await repository.get(scope, "project", input.id)).state).toBe(
      "admitted",
    );
  });
  it("rolls back admission on a batch failure", async () => {
    const { scope, input } = await setup();
    testDb.failNextBatchAt(3);
    await expect(repository.admit(scope, input)).rejects.toThrow();
    expect(
      await testDb.execute("select id from project_website_research_attempts"),
    ).toHaveLength(0);
  });
});
