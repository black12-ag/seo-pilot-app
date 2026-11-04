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
import { CompetitorResearchRepository as repository } from "./CompetitorResearchRepository";
const repo = repository;

beforeEach(testDb.seedProject);
afterAll(testDb.close);
const actor = {
  userId: "user",
  userEmail: "authority@example.com",
  organizationId: "organization",
  role: "owner",
  surface: "web" as const,
};

async function issuedSearch() {
  const { scope, snapshot } = await repo.getSnapshot(actor, "project");
  const input = {
    projectId: "project",
    requestId: crypto.randomUUID(),
    expectedContextVersion: snapshot.contextVersion,
    contextHash: snapshot.contextHash,
    capabilityFingerprint: "a".repeat(64),
    confirmedPaidWork: true as const,
  };
  const data = {
    id: crypto.randomUUID(),
    input,
    requestHash: "b".repeat(64),
    snapshot,
    businessSummary: "Business",
    blockedReason: null,
    modelBackendId: "backend",
    modelConfigurationHash: "c".repeat(64),
    nowMs: 1000,
  };
  await repo.admit(scope, data);
  await repo.prepareOperation(
    data.id,
    "search_0",
    { inputHash: "d".repeat(64), queryText: "query", targetUrl: null },
    1001,
  );
  const issued = await repo.issueOperation(
    data.id,
    "search_0",
    1002,
    data.modelConfigurationHash,
  );
  if (issued.kind !== "issued") throw new Error("Search not issued");
  return { data, token: issued.issueToken };
}

async function issuedClassifier() {
  const { data, token } = await issuedSearch();
  await repo.recordOperationFailure(
    data.id,
    "search_0",
    token,
    { outcome: "failed", reason: "provider_unavailable", billing: null },
    1003,
  );
  const candidateId = crypto.randomUUID(),
    otherId = crypto.randomUUID();
  await testDb.execute(
    `insert into project_competitor_research_candidates (id,project_id,run_id,domain,rank_order,source_url,source_excerpt,source_hash,source_captured_at_ms,classification,name) values ('${candidateId}','project','${data.id}','rival.com',0,'https://rival.com/','Evidence','hash',1000,'pending','Rival'), ('${otherId}','project','${data.id}','other.com',1,'https://other.com/','Evidence','hash',1000,'pending','Other')`,
  );
  await repo.prepareOperation(
    data.id,
    "classify",
    { inputHash: "e".repeat(64), queryText: null, targetUrl: null },
    1004,
  );
  const issued = await repo.issueOperation(
    data.id,
    "classify",
    1005,
    data.modelConfigurationHash,
  );
  if (issued.kind !== "issued") throw new Error("Classifier not issued");
  const [operation] = await testDb.execute(
    `select id from project_competitor_research_operations where run_id='${data.id}' and slot='classify'`,
  );
  const response = {
    v: 1 as const,
    operation: "classify_competitors" as const,
    requestId: String(operation?.id),
    status: "succeeded" as const,
    output: { selections: [{ candidateId, reason: "Competes directly" }] },
    usage: {
      backendId: "backend",
      modelId: "model",
      basis: "usd" as const,
      costUsd: 0.02,
      inputTokens: 10,
      outputTokens: 5,
    },
  };
  return {
    runId: data.id,
    token: issued.issueToken,
    response,
    candidateId,
    otherId,
  };
}

describe("classifier receipts", () => {
  it("stores one decision for simultaneous identical completions", async () => {
    const { runId, token, response } = await issuedClassifier();
    expect(
      await Promise.all([
        repo.recordClassification(runId, token, response, 1006),
        repo.recordClassification(runId, token, response, 1006),
      ]),
    ).toEqual([{ kind: "stored" }, { kind: "stored" }]);
    const rows = await testDb.execute(
      `select classification || ':' || coalesce(rationale,'') as decision from project_competitor_research_candidates where run_id='${runId}' order by rank_order`,
    );
    expect(rows).toEqual([
      { decision: "verified:Competes directly" },
      { decision: "not_competitor:" },
    ]);
  });
  it("replays only an identical classifier receipt without rewriting decisions or usage", async () => {
    const {
      runId: id,
      token,
      response,
      candidateId,
      otherId,
    } = await issuedClassifier();
    const r = repo;
    expect(await r.recordClassification(id, token, response, 1006)).toEqual({
      kind: "stored",
    });
    const before = await testDb.execute(
      `select id,classification,rationale from project_competitor_research_candidates where run_id='${id}' order by id`,
    );
    expect(await r.recordClassification(id, token, response, 1007)).toEqual({
      kind: "stored",
    });
    for (const output of [
      { selections: [{ candidateId: otherId, reason: "Competes directly" }] },
      { selections: [{ candidateId, reason: "Different reason" }] },
      { selections: [] },
    ])
      expect(
        await r.recordClassification(id, token, { ...response, output }, 1007),
      ).toEqual({ kind: "blocked" });
    for (const usage of [
      { ...response.usage, costUsd: 0.03 },
      { ...response.usage, backendId: "other" },
      { ...response.usage, modelId: "other" },
      { ...response.usage, basis: "quota" as const },
      { ...response.usage, inputTokens: 11 },
      { ...response.usage, outputTokens: 6 },
    ])
      expect(
        await r.recordClassification(id, token, { ...response, usage }, 1007),
      ).toEqual({ kind: "blocked" });
    expect(
      await r.recordClassification(id, crypto.randomUUID(), response, 1007),
    ).toEqual({ kind: "blocked" });
    expect(
      await testDb.execute(
        `select id,classification,rationale from project_competitor_research_candidates where run_id='${id}' order by id`,
      ),
    ).toEqual(before);
    const [receipt] = await testDb.execute(
      `select state,backend_model_id,usage_basis,cost_usd,input_tokens,output_tokens from project_competitor_research_operations where run_id='${id}' and slot='classify'`,
    );
    expect(receipt).toMatchObject({
      state: "succeeded",
      backend_model_id: "model",
      usage_basis: "usd",
    });
    expect([
      Number(receipt?.cost_usd),
      Number(receipt?.input_tokens),
      Number(receipt?.output_tokens),
    ]).toEqual([0.02, 10, 5]);
    await testDb.execute(
      "update member set role='member' where id='membership'",
    );
    expect(await r.recordClassification(id, token, response, 1008)).toEqual({
      kind: "blocked",
    });
    await testDb.execute(
      "update member set role='owner' where id='membership'",
    );
    await testDb.execute(
      `update project_competitor_research_runs set redacted_at_ms=1009 where id='${id}'`,
    );
    expect(await r.recordClassification(id, token, response, 1010)).toEqual({
      kind: "blocked",
    });
  });
});

describe("operation failures", () => {
  it("preserves a known charge after a provider failure", async () => {
    const { data, token } = await issuedSearch();
    const r = repository;
    const id = data.id;
    const failure = {
      outcome: "failed" as const,
      reason: "provider_unavailable",
      billing: {
        provider: "dataforseo" as const,
        costUsd: 0.12,
        providerTaskId: "task",
      },
    };
    expect(
      await r.recordOperationFailure(id, "search_0", token, failure, 1003),
    ).toEqual({ kind: "stored" });
    expect(
      await r.recordOperationFailure(id, "search_0", token, failure, 1004),
    ).toEqual({ kind: "stored" });
    for (const billing of [
      { ...failure.billing, provider: "openrouter" as const },
      { ...failure.billing, providerTaskId: "changed" },
    ])
      expect(
        await r.recordOperationFailure(
          id,
          "search_0",
          token,
          { ...failure, billing },
          1005,
        ),
      ).toEqual({ kind: "blocked" });
    const [row] = await testDb.execute(
      "select state,cost_usd,provider,provider_task_id from project_competitor_research_operations where slot='search_0'",
    );
    expect(row?.state).toBe("failed");
    expect(Number(row?.cost_usd)).toBe(0.12);
    expect(row).toMatchObject({
      provider: "dataforseo",
      provider_task_id: "task",
    });
  });
  it("rolls back candidates and does not reissue an unknown lost reply", async () => {
    const { data, token } = await issuedSearch();
    const r = repository;
    const id = data.id;
    testDb.failNextBatchAt(4);
    await expect(
      r.recordSearch(
        id,
        "search_0",
        token,
        {
          billing: { path: ["serp"], costUsd: 0.1 },
          organic: [{ type: "organic", url: "https://rival.com/" }],
        },
        1003,
      ),
    ).rejects.toThrow();
    expect(
      await testDb.execute(
        "select id from project_competitor_research_candidates",
      ),
    ).toHaveLength(0);
    expect(
      await r.recordOperationFailure(
        id,
        "search_0",
        token,
        {
          outcome: "unknown",
          reason: "operation_outcome_unknown",
          billing: null,
        },
        1003,
      ),
    ).toEqual({ kind: "stored" });
    expect(
      await r.issueOperation(id, "search_0", 1004, data.modelConfigurationHash),
    ).toEqual({ kind: "uncertain" });
    await r.prepareOperation(
      id,
      "search_1",
      {
        inputHash: "e".repeat(64),
        queryText: "another query",
        targetUrl: null,
      },
      1005,
    );
    expect(
      await r.issueOperation(id, "search_1", 1006, data.modelConfigurationHash),
    ).toEqual({ kind: "blocked" });
  });
  it("rejects a late result after redaction", async () => {
    const { data, token } = await issuedSearch();
    await testDb.execute(
      `update project_competitor_research_runs set redacted_at_ms=1003 where id='${data.id}'`,
    );
    expect(
      await repo.recordOperationFailure(
        data.id,
        "search_0",
        token,
        { outcome: "failed", reason: "provider_unavailable", billing: null },
        1004,
      ),
    ).toEqual({ kind: "blocked" });
    const [row] = await testDb.execute(
      "select state from project_competitor_research_operations where slot='search_0'",
    );
    expect(row?.state).toBe("issued");
  });
});

describe("concurrent reservations", () => {
  it("admits one run and replays an identical simultaneous request", async () => {
    const projectId = crypto.randomUUID();
    await testDb.execute(
      `insert into projects (id,organization_id,name,domain) values ('${projectId}','organization','Business','example.com')`,
    );
    const { scope, snapshot } = await repo.getSnapshot(actor, projectId);
    const data = {
      projectId,
      id: crypto.randomUUID(),
      requestId: crypto.randomUUID(),
      requestHash: "a".repeat(64),
      snapshot,
      businessSummary: "Business",
      modelBackendId: null,
      modelConfigurationHash: "b".repeat(64),
      deadlineAtMs: 100000,
      nowMs: 1000,
    };
    const results = await Promise.all([
      repo.admitSetup(scope, data),
      repo.admitSetup(scope, data),
    ]);
    expect(new Set(results.map((r) => r.kind))).toEqual(
      new Set(["created", "replayed"]),
    );
    expect(new Set(results.map((r) => r.runId)).size).toBe(1);
    expect(
      await repo.admitSetup(scope, {
        ...data,
        id: crypto.randomUUID(),
        requestHash: "d".repeat(64),
      }),
    ).toMatchObject({ kind: "conflict" });
  });
  it("admits only one of two simultaneous distinct requests", async () => {
    const projectId = crypto.randomUUID();
    await testDb.execute(
      `insert into projects (id,organization_id,name,domain) values ('${projectId}','organization','Business','example.com')`,
    );
    const { scope, snapshot } = await repo.getSnapshot(actor, projectId);
    const data = {
      projectId,
      id: crypto.randomUUID(),
      requestId: crypto.randomUUID(),
      requestHash: "a".repeat(64),
      snapshot,
      businessSummary: "Business",
      modelBackendId: null,
      modelConfigurationHash: "b".repeat(64),
      deadlineAtMs: 100000,
      nowMs: 1000,
    };
    const results = await Promise.all([
      repo.admitSetup(scope, data),
      repo.admitSetup(scope, {
        ...data,
        id: crypto.randomUUID(),
        requestId: crypto.randomUUID(),
      }),
    ]);
    expect(new Set(results.map((r) => r.kind))).toEqual(
      new Set(["created", "busy"]),
    );
    expect(
      await testDb.execute(
        `select id from project_competitor_research_runs where project_id='${projectId}'`,
      ),
    ).toHaveLength(1);
  });
});
