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

beforeEach(testDb.seedProject);
afterAll(testDb.close);

function insertRun(
  id: string,
  requestId: string,
  active: string | null = "project",
) {
  return testDb.execute(`insert into project_competitor_research_runs
    (id,project_id,organization_id,admission_token,request_id,request_hash,origin,state,outcome,active_project_id,surface,model_configuration_hash,location_code,language_code,context_version,context_hash,business_summary,limits_profile,created_at_ms,deadline_at_ms,finished_at_ms,billing_state)
    values ('${id}','project','organization','token','${requestId}','hash','explicit',${active ? "'queued',null,'project'" : "'finished','blocked',null"},'web','model',2840,'en',0,'hash','summary','competitor-discovery-v1',1,100,${active ? "null" : "2"},'not_started')`);
}

describe("competitor research migration constraints", () => {
  it("enforces one active run and one request receipt per project", async () => {
    await insertRun("one", "request-one");
    await expect(insertRun("two", "request-two")).rejects.toThrow();
    await expect(insertRun("three", "request-one", null)).rejects.toThrow();
    await insertRun("four", "request-four", null);
  });

  it("cascades run evidence and preserves unrelated competitors", async () => {
    await testDb.execute(
      "insert into project_competitors (id,project_id,domain,updated_by) values ('saved','project','saved.example','user')",
    );
    await insertRun("run", "request");
    await testDb.execute(
      "insert into project_competitor_research_operations (id,project_id,run_id,slot,kind,state,input_hash,usage_basis) values ('op','project','run','search_0','search','prepared','hash','unknown')",
    );
    await testDb.execute(
      "insert into project_competitor_research_candidates (id,project_id,run_id,domain,rank_order,classification) values ('candidate','project','run','rival.example',0,'pending')",
    );
    await testDb.execute(
      "delete from project_competitor_research_runs where id='run'",
    );
    expect(
      await testDb.execute(
        "select id from project_competitor_research_operations",
      ),
    ).toHaveLength(0);
    expect(
      await testDb.execute(
        "select id from project_competitor_research_candidates",
      ),
    ).toHaveLength(0);
    expect(
      await testDb.execute(
        "select id from project_competitors where id='saved'",
      ),
    ).toHaveLength(1);
  });

  it("rejects candidate evidence scoped to another project", async () => {
    await insertRun("run", "request");
    await expect(
      testDb.execute(
        "insert into project_competitor_research_candidates (id,project_id,run_id,domain,rank_order,classification) values ('candidate','foreign-project','run','rival.example',0,'pending')",
      ),
    ).rejects.toThrow();
  });
});

const actor = {
  userId: "user",
  userEmail: "authority@example.com",
  organizationId: "organization",
  role: "owner",
  surface: "web" as const,
};
async function admitted(blockedReason: "model_not_configured" | null = null) {
  const { scope, snapshot } = await repository.getSnapshot(actor, "project");
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
    businessSummary: "business",
    blockedReason,
    modelBackendId: "backend",
    modelConfigurationHash: "c".repeat(64),
    nowMs: 1000,
  };
  return { scope, data, result: await repository.admit(scope, data) };
}
it("creates a blocked receipt without operation slots", async () => {
  const { data, result } = await admitted("model_not_configured");
  expect(result).toEqual({ kind: "created", runId: data.id });
  expect(
    await testDb.execute(
      "select id from project_competitor_research_operations",
    ),
  ).toHaveLength(0);
  const [row] = await testDb.execute(
    "select state, outcome, active_project_id from project_competitor_research_runs",
  );
  expect(row).toMatchObject({
    state: "finished",
    outcome: "blocked",
    active_project_id: null,
  });
});
it("binds one input and issues it once under the current member and configuration", async () => {
  const { data, result } = await admitted();
  expect(result.kind).toBe("created");
  const input = {
    inputHash: "d".repeat(64),
    queryText: "business alternatives",
    targetUrl: null,
  };
  expect(
    await repository.prepareOperation(data.id, "search_0", input, 1001),
  ).toEqual({ kind: "prepared" });
  expect(
    await repository.prepareOperation(
      data.id,
      "search_0",
      { ...input, queryText: "changed" },
      1001,
    ),
  ).toEqual({ kind: "conflict" });
  expect(
    await repository.issueOperation(data.id, "search_0", 1002, "wrong"),
  ).toEqual({ kind: "blocked" });
  const first = await repository.issueOperation(
    data.id,
    "search_0",
    1002,
    data.modelConfigurationHash,
  );
  expect(first.kind).toBe("issued");
  expect(
    await repository.issueOperation(
      data.id,
      "search_0",
      1003,
      data.modelConfigurationHash,
    ),
  ).toEqual({ kind: "uncertain" });
});
it("rolls back admission and operation slots after a mid-batch failure", async () => {
  testDb.failNextBatchAt(5);
  await expect(admitted()).rejects.toThrow();
  expect(
    await testDb.execute("select id from project_competitor_research_runs"),
  ).toHaveLength(0);
  expect(
    await testDb.execute(
      "select id from project_competitor_research_operations",
    ),
  ).toHaveLength(0);
});

it("records bounded search and same-domain page evidence, then classifies only sourced candidates", async () => {
  const { data } = await admitted();
  const r = repository;
  const id = data.id;
  const config = data.modelConfigurationHash;
  const query = {
    inputHash: "d".repeat(64),
    queryText: "business alternatives",
    targetUrl: null,
  };
  await r.prepareOperation(id, "search_0", query, 1001);
  const search = await r.issueOperation(id, "search_0", 1002, config);
  if (search.kind !== "issued") throw new Error("Search not issued");
  expect(
    await r.recordSearch(
      id,
      "search_0",
      search.issueToken,
      {
        billing: { path: ["serp"], costUsd: 0.01 },
        organic: [{ type: "organic", url: "https://rival.com/" }],
      },
      1003,
    ),
  ).toEqual({ kind: "stored" });
  const [candidate] = await testDb.execute(
    "select id, domain from project_competitor_research_candidates",
  );
  expect(candidate?.domain).toBe("rival.com");
  await r.prepareOperation(
    id,
    "page_0",
    {
      inputHash: "e".repeat(64),
      queryText: null,
      targetUrl: "https://rival.com/",
    },
    1004,
  );
  const page = await r.issueOperation(id, "page_0", 1005, config);
  if (page.kind !== "issued") throw new Error("Page not issued");
  const sourceText = "A real public competitor description";
  const extraction = {
    requestedUrl: "https://rival.com/",
    resolvedUrl: "https://rival.com/",
    capturedAtMs: 1006,
    httpStatus: 200,
    redirectCount: 0,
    fetchAttempted: true,
    responseComplete: true,
    textTruncated: false,
    extractedBytes: new TextEncoder().encode(sourceText).byteLength,
    extractionStatus: "usable" as const,
    extractionReason: null,
    extractionMethod: "public_html_text" as const,
    extractionVersion: "public-source-v1" as const,
    title: "Rival",
    sourceText,
    publisherDate: null,
    language: null,
    market: null,
  };
  expect(
    await r.recordPage(id, "page_0", page.issueToken, extraction, 1006),
  ).toEqual({ kind: "stored" });
  await r.prepareOperation(
    id,
    "classify",
    { inputHash: "f".repeat(64), queryText: null, targetUrl: null },
    1007,
  );
  const classification = await r.issueOperation(id, "classify", 1008, config);
  if (classification.kind !== "issued") throw new Error("Model not issued");
  const [op] = await testDb.execute(
    "select id from project_competitor_research_operations where slot='classify'",
  );
  const response = {
    v: 1 as const,
    operation: "classify_competitors" as const,
    requestId: String(op?.id),
    status: "succeeded" as const,
    output: {
      selections: [
        { candidateId: String(candidate?.id), reason: "Competes for buyers" },
      ],
    },
    usage: {
      backendId: "backend",
      modelId: null,
      basis: "unknown" as const,
      costUsd: null,
      inputTokens: null,
      outputTokens: null,
    },
  };
  expect(
    await r.recordClassification(id, classification.issueToken, response, 1009),
  ).toEqual({ kind: "stored" });
  const [row] = await testDb.execute(
    "select classification,source_url from project_competitor_research_candidates",
  );
  expect(row).toMatchObject({
    classification: "verified",
    source_url: "https://rival.com/",
  });
  expect(await r.claimBilling(id, 1010)).toEqual({
    kind: "blocked",
  });
  expect(await r.finish(id, "complete", null, 1011)).toEqual({
    kind: "finished",
  });
  const billing = await r.claimBilling(id, 1012);
  expect(billing.kind).toBe("claimed");
  if (billing.kind !== "claimed") throw new Error("Billing not claimed");
  expect(await r.recordBilling(id, billing.billingToken, "unknown")).toEqual({
    kind: "stored",
  });
  expect(await r.claimBilling(id, 1013)).toEqual({
    kind: "existing",
    state: "unknown",
  });
});
it("rejects a late search response after the run is terminal", async () => {
  const { data } = await admitted();
  await repository.prepareOperation(
    data.id,
    "search_0",
    { inputHash: "d".repeat(64), queryText: "query", targetUrl: null },
    1001,
  );
  const issued = await repository.issueOperation(
    data.id,
    "search_0",
    1002,
    data.modelConfigurationHash,
  );
  if (issued.kind !== "issued") throw new Error("Search not issued");
  await repository.finish(
    data.id,
    "unknown",
    "operation_outcome_unknown",
    1003,
  );
  expect(
    await repository.recordSearch(
      data.id,
      "search_0",
      issued.issueToken,
      {
        billing: { path: ["serp"], costUsd: 0.01 },
        organic: [{ type: "organic", url: "https://rival.com/" }],
      },
      1004,
    ),
  ).toEqual({ kind: "blocked" });
  expect(
    await testDb.execute(
      "select id from project_competitor_research_candidates",
    ),
  ).toHaveLength(0);
});
it("does not claim billing when no positive charge exists", async () => {
  const { data } = await admitted();
  await repository.finish(data.id, "blocked", "model_not_configured", 1001);
  expect(await repository.claimBilling(data.id, 1002)).toEqual({
    kind: "not_required",
  });
  const [run] = await testDb.execute(
    "select billing_state from project_competitor_research_runs",
  );
  expect(run?.billing_state).toBe("not_started");
});
it.each([
  ["domain", "update projects set domain='changed.example' where id='project'"],
  ["market", "update projects set language_code='fr' where id='project'"],
  [
    "organization",
    "update projects set organization_id='foreign' where id='project'",
  ],
  [
    "archive",
    "update projects set archived_at='2026-01-01' where id='project'",
  ],
  [
    "context",
    "insert into content_project_state(project_id,context_version,updated_at_ms) values('project',1,1003)",
  ],
  ["membership removal", "delete from member where id='membership'"],
  ["membership role", "update member set role='member' where id='membership'"],
])("blocks issuance after %s changes", async (_label, statement) => {
  const { data } = await admitted();
  await repository.prepareOperation(
    data.id,
    "search_0",
    { inputHash: "d".repeat(64), queryText: "query", targetUrl: null },
    1001,
  );
  await testDb.execute(statement);
  expect(
    await repository.issueOperation(
      data.id,
      "search_0",
      1002,
      data.modelConfigurationHash,
    ),
  ).toEqual({ kind: "blocked" });
});
it("blocks issuance after a sponsor is removed and re-added with a new membership id", async () => {
  const { data } = await admitted();
  await repository.prepareOperation(
    data.id,
    "search_0",
    { inputHash: "d".repeat(64), queryText: "query", targetUrl: null },
    1001,
  );
  await testDb.execute("delete from member where id='membership'");
  await testDb.execute(
    `insert into member(id,organization_id,user_id,role,created_at) values('new-membership','organization','user','owner',${testDb.provider === "postgres" ? "now()" : "0"})`,
  );
  expect(
    await repository.issueOperation(
      data.id,
      "search_0",
      1002,
      data.modelConfigurationHash,
    ),
  ).toEqual({ kind: "blocked" });
});
