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

import { CompetitorResearchRepository as repo } from "./CompetitorResearchRepository";
import { WebsiteResearchAttemptRepository as attempts } from "@/server/features/projects/repositories/WebsiteResearchAttemptRepository";
import { WebsiteResearchAttemptService } from "@/server/features/projects/services/WebsiteResearchAttemptService";
import {
  actor,
  setup,
  setupRunInput,
} from "@/server/features/projects/repositories/websiteResearchAttemptTestDb";

beforeEach(testDb.seedProject);
afterAll(testDb.close);

async function finishedSetup() {
  const { scope, input } = await setup();
  const run = { ...setupRunInput(input), requestId: input.id };
  expect((await repo.admitSetup(scope, run)).kind).toBe("created");
  const token = (await repo.getRun(scope, input.projectId, run.id)).run
    .admissionToken;
  expect(
    await repo.finish(run.id, "unknown", "operation_outcome_unknown", 1002),
  ).toMatchObject({ kind: "finished" });
  return { run, token, scope };
}

it("records known cost after membership loss once, without new provider authority", async () => {
  const { run, token, scope } = await finishedSetup();
  await testDb.execute("delete from member where id='membership'");
  const input = {
    runId: run.id,
    admissionToken: token,
    knownCostUsd: 0.05,
    costComplete: false,
    billingStatus: "unknown" as const,
    nowMs: 1003,
  };
  expect(await repo.recordSetupSettlement(input)).toEqual({ kind: "stored" });
  expect(await repo.recordSetupSettlement(input)).toEqual({ kind: "replayed" });
  expect(
    await repo.recordSetupSettlement({ ...input, knownCostUsd: 0.06 }),
  ).toEqual({ kind: "conflict" });
  const rows = await testDb.execute(
    `select cost_usd,usage_basis,input_hash from project_competitor_research_operations where run_id='${run.id}'`,
  );
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({
    cost_usd: 0.05,
    usage_basis: "unknown",
    input_hash: null,
  });
  await testDb.execute(
    `insert into member (id,organization_id,user_id,role,created_at) values ('replacement','organization','user','owner',${testDb.pg ? "now()" : "0"})`,
  );
  const read = await repo.getRun(
    { ...scope, memberId: "replacement", actor },
    "project",
    run.id,
  );
  expect(read.run.billingState).toBe("unknown");
  expect(read.operations[0]).toMatchObject({
    costUsd: 0.05,
    usageBasis: "unknown",
  });
});

it("rejects unobserved or contradictory accounting", async () => {
  const { run, token } = await finishedSetup();
  const input = {
    runId: run.id,
    admissionToken: token,
    knownCostUsd: 1,
    costComplete: true,
    billingStatus: "not_required" as const,
    nowMs: 1003,
  };
  expect((await repo.recordSetupSettlement(input)).kind).toBe("conflict");
  expect(
    (
      await repo.recordSetupSettlement({
        ...input,
        admissionToken: "wrong",
        billingStatus: "unknown",
      })
    ).kind,
  ).toBe("blocked");
  expect(
    (
      await repo.recordSetupSettlement({
        ...input,
        knownCostUsd: null,
        billingStatus: "unknown",
      })
    ).kind,
  ).toBe("conflict");
  await testDb.execute(
    `update project_competitor_research_runs set reason='restored' where id='${run.id}'`,
  );
  expect(
    (await repo.recordSetupSettlement({ ...input, billingStatus: "unknown" }))
      .kind,
  ).toBe("blocked");
  expect(
    await testDb.execute(
      `select id from project_competitor_research_operations where run_id='${run.id}'`,
    ),
  ).toHaveLength(0);
});

it("keeps one settlement row when identical replies race", async () => {
  const { run, token } = await finishedSetup();
  const input = {
    runId: run.id,
    admissionToken: token,
    knownCostUsd: 0,
    costComplete: true,
    billingStatus: "not_required" as const,
    nowMs: 1003,
  };
  const replies = await Promise.all([
    repo.recordSetupSettlement(input),
    repo.recordSetupSettlement(input),
  ]);
  expect(new Set(replies.map((reply) => reply.kind))).toEqual(
    new Set(["replayed", "stored"]),
  );
  expect(
    await testDb.execute(
      `select id from project_competitor_research_operations where run_id='${run.id}'`,
    ),
  ).toHaveLength(1);
});

it("refuses rotated and erased run proofs without accounting writes", async () => {
  const { run, token } = await finishedSetup();
  const input = {
    runId: run.id,
    admissionToken: token,
    knownCostUsd: 0.03,
    costComplete: true,
    billingStatus: "unknown" as const,
    nowMs: 1003,
  };
  await testDb.execute(
    `update project_competitor_research_runs set admission_token='rotated' where id='${run.id}'`,
  );
  expect((await repo.recordSetupSettlement(input)).kind).toBe("blocked");
  await testDb.execute(
    `update project_competitor_research_runs set admission_token='${token}',redacted_at_ms=1003 where id='${run.id}'`,
  );
  expect((await repo.recordSetupSettlement(input)).kind).toBe("blocked");
  expect(
    await testDb.execute(
      `select id from project_competitor_research_operations where run_id='${run.id}'`,
    ),
  ).toHaveLength(0);
});

it("finds the exact orphan beyond the recent-ten window with live scoped authority", async () => {
  const { scope, input } = await setup();
  const first = { ...setupRunInput(input), requestId: input.id };
  expect((await repo.admitSetup(scope, first)).kind).toBe("created");
  await repo.finish(first.id, "blocked", "deadline", 1002);
  for (let index = 0; index < 11; index++) {
    const next = { ...setupRunInput(input), nowMs: 1003 + index };
    expect((await repo.admitSetup(scope, next)).kind).toBe("created");
    await repo.finish(next.id, "blocked", "deadline", 1003 + index);
  }
  await testDb.execute(
    `update project_competitor_research_runs set state='queued',outcome=null,reason=null,active_project_id='project',finished_at_ms=null,revoked_at_ms=null where id='${first.id}'`,
  );
  expect(
    (await repo.listRecent(scope, "project")).some(
      (run) => run.id === first.id,
    ),
  ).toBe(false);
  expect(
    (await repo.getSetupRunByRequest(scope, "project", input.id))?.id,
  ).toBe(first.id);
  await testDb.execute("update member set role='admin' where id='membership'");
  await expect(
    repo.getSetupRunByRequest(scope, "project", input.id),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
});

it("releases an admitted-before-link orphan only after the original attempt expires", async () => {
  const { scope, input } = await setup();
  const admitted = await attempts.admit(scope, input);
  if (admitted.kind !== "created") throw new Error("expected attempt");
  const row = await attempts.get(scope, "project", input.id);
  const run = {
    ...setupRunInput(input),
    requestId: input.id,
    requestHash: row.requestHash!,
  };
  expect((await repo.admitSetup(scope, run)).kind).toBe("created");
  expect(
    (await repo.getSetupRunByRequest(scope, "project", input.id))?.state,
  ).toBe("queued");
  const result = await WebsiteResearchAttemptService.get(
    actor,
    "project",
    input.id,
  );
  expect(result.status).toBe("failed");
  expect(JSON.stringify(result)).not.toMatch(
    /admissionToken|executionToken|requestHash|sponsor/,
  );
  expect((await repo.getRun(scope, "project", run.id)).run).toMatchObject({
    state: "finished",
    outcome: "blocked",
    reason: "deadline",
  });
  expect((await attempts.get(scope, "project", input.id)).state).toBe("failed");
});
