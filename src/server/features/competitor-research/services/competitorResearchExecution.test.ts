import { afterAll, beforeEach, expect, it, vi } from "vitest";

const { testDb, search, extract, classify, billing } = await vi.hoisted(
  async () => {
    const { createCompetitorResearchTestDb } =
      await import("./competitorResearchTestDb");
    return {
      testDb: await createCompetitorResearchTestDb(),
      search: vi.fn(),
      extract: vi.fn(),
      classify: vi.fn(),
      billing: vi.fn(),
    };
  },
);
vi.mock("cloudflare:workers", () => ({
  env: { DATABASE_PROVIDER: testDb.provider },
}));
vi.mock("@/db", () => ({ db: testDb.db }));
vi.mock("@/db/runBatch", () => ({ runBatch: testDb.runBatch }));
vi.mock("@/server/lib/runtime-env", () => ({
  usesBetterAuthServer: async () => true,
}));
vi.mock("@/server/lib/dataforseo/serp", () => ({ fetchLiveSerp: search }));
vi.mock("@/server/features/content/services/contentSourceExtraction", () => ({
  extractPublicSource: extract,
}));
vi.mock("./competitorModel", () => ({
  classifyCompetitorCandidates: classify,
}));
vi.mock("./competitorResearchAccess", async (importOriginal) => ({
  ...(await importOriginal()),
  competitorExecutionConfiguration: async () => ({
    modelConfigurationHash: "c".repeat(64),
    search: true,
    modelConfigured: true,
  }),
}));
vi.mock("@/server/billing/researchSpend", () => ({
  billResearchSpend: billing,
}));

import { CompetitorResearchRepository as repository } from "../repositories/CompetitorResearchRepository";
import { DataforseoChargedTaskError } from "@/server/lib/dataforseo/envelope";
import { runCompetitorResearch } from "./competitorResearchExecution";

const actor = {
  userId: "user",
  userEmail: "authority@example.com",
  organizationId: "organization",
  role: "owner",
  surface: "web" as const,
};
function usableExtraction({ requestedUrl }: { requestedUrl: string }) {
  return {
    requestedUrl,
    resolvedUrl: requestedUrl,
    capturedAtMs: Date.now(),
    httpStatus: 200,
    redirectCount: 0,
    fetchAttempted: true,
    responseComplete: true,
    textTruncated: false,
    extractedBytes: 15,
    extractionStatus: "usable",
    extractionReason: null,
    extractionMethod: "public_html_text",
    extractionVersion: "public-source-v1",
    title: "Rival",
    sourceText: "A rival company",
    publisherDate: null,
    language: null,
    market: null,
  };
}
async function admitted() {
  const { scope, snapshot } = await repository.getSnapshot(actor, "project");
  const input = {
    projectId: "project",
    requestId: crypto.randomUUID(),
    expectedContextVersion: snapshot.contextVersion,
    contextHash: snapshot.contextHash,
    capabilityFingerprint: "a".repeat(64),
    confirmedPaidWork: true as const,
  };
  const id = crypto.randomUUID();
  expect(
    await repository.admit(scope, {
      id,
      input,
      requestHash: "b".repeat(64),
      snapshot,
      businessSummary: "Our business",
      blockedReason: null,
      modelBackendId: "openrouter",
      modelConfigurationHash: "c".repeat(64),
      nowMs: Date.now(),
    }),
  ).toMatchObject({ kind: "created", runId: id });
  return { id, scope };
}

beforeEach(async () => {
  await testDb.seedProject();
  search.mockResolvedValue({
    data: [],
    billing: { path: ["serp", "google"], costUsd: 0.01 },
  });
  billing.mockResolvedValue({ status: "selfhost_external" });
});
afterAll(testDb.close);

it("uses one bounded search for fallback brand and treats a real empty SERP as complete", async () => {
  const { id, scope } = await admitted();
  expect(await runCompetitorResearch(id)).toEqual({ runId: id });
  expect(search).toHaveBeenCalledTimes(1);
  expect(search.mock.calls[0]?.[0]).toMatchObject({
    keyword: "Project alternatives",
    depth: 10,
  });
  expect(search.mock.calls[0]?.[1]).toMatchObject({ maxServerErrorRetries: 0 });
  expect(extract).not.toHaveBeenCalled();
  expect(classify).not.toHaveBeenCalled();
  const row = await repository.getRun(scope, "project", id);
  expect(row.run.outcome).toBe("complete");
  expect(row.run.billingState).toBe("selfhost_external");
  await runCompetitorResearch(id);
  expect(search).toHaveBeenCalledTimes(1);
});

it("never reissues a possibly sent search after a lost reply", async () => {
  const { id, scope } = await admitted();
  const queryText = "Project alternatives";
  const { sha256Hex } = await import("@/server/lib/audit/ids");
  expect(
    await repository.prepareOperation(
      id,
      "search_0",
      {
        inputHash: await sha256Hex(JSON.stringify({ queryText })),
        queryText,
        targetUrl: null,
      },
      Date.now(),
    ),
  ).toMatchObject({ kind: "prepared" });
  expect(
    await repository.issueOperation(id, "search_0", Date.now(), "c".repeat(64)),
  ).toMatchObject({ kind: "issued" });
  await runCompetitorResearch(id);
  expect(search).not.toHaveBeenCalled();
  const row = await repository.getRun(scope, "project", id);
  expect(row.run.outcome).toBe("unknown");
  expect(
    row.operations.find((operation) => operation.slot === "search_0")?.state,
  ).toBe("issued");
});

it("classifies only persisted page evidence and retains the known search charge", async () => {
  const { id, scope } = await admitted();
  search.mockResolvedValueOnce({
    data: [{ type: "organic", url: "https://rival.com/page" }],
    billing: { path: ["serp"], costUsd: 0.02 },
  });
  extract.mockImplementation(usableExtraction);
  classify.mockImplementation(
    async (request: { requestId: string; candidates: { id: string }[] }) => ({
      v: 1,
      operation: "classify_competitors",
      requestId: request.requestId,
      status: "succeeded",
      output: {
        selections: [
          { candidateId: request.candidates[0]?.id, reason: "Same business" },
        ],
      },
      usage: {
        backendId: "openrouter",
        modelId: "actual",
        basis: "usd",
        costUsd: 0.03,
        inputTokens: 10,
        outputTokens: 5,
      },
    }),
  );
  await runCompetitorResearch(id);
  const row = await repository.getRun(scope, "project", id);
  expect(row.run.outcome).toBe("complete");
  expect(row.candidates[0]).toMatchObject({
    classification: "verified",
    sourceUrl: "https://rival.com/page",
  });
  expect(classify).toHaveBeenCalledTimes(1);
  expect(classify.mock.calls[0]?.[0]).toMatchObject({
    candidates: [expect.anything()],
  });
  expect(billing).toHaveBeenCalledTimes(1);
  expect(billing.mock.calls[0]?.[1]).toHaveLength(2);
});

it("caps two saved-keyword searches at five sourced pages and one empty classification", async () => {
  await testDb.execute(
    "update projects set ai_research_keywords='alpha\nbeta' where id='project'",
  );
  const { id, scope } = await admitted();
  search.mockImplementation(async () => ({
    data: Array.from({ length: 10 }, (_, index) => ({
      type: "organic",
      url: `https://rival${index}.com/`,
    })),
    billing: { path: ["serp"], costUsd: 0.01 },
  }));
  extract.mockImplementation(usableExtraction);
  classify.mockImplementation(async (request: { requestId: string }) => ({
    v: 1,
    operation: "classify_competitors",
    requestId: request.requestId,
    status: "succeeded",
    output: { selections: [] },
    usage: {
      backendId: "openrouter",
      modelId: "actual",
      basis: "usd",
      costUsd: 0.01,
      inputTokens: 10,
      outputTokens: 2,
    },
  }));
  await runCompetitorResearch(id);
  const row = await repository.getRun(scope, "project", id);
  expect(row.run.outcome).toBe("complete");
  expect(row.candidates).toHaveLength(5);
  expect(search).toHaveBeenCalledTimes(2);
  expect(extract).toHaveBeenCalledTimes(5);
  expect(classify).toHaveBeenCalledTimes(1);
  expect(
    row.candidates.every(
      (candidate) => candidate.classification === "not_competitor",
    ),
  ).toBe(true);
});

it("never verifies a foreign model-selected ID", async () => {
  const { id, scope } = await admitted();
  search.mockResolvedValueOnce({
    data: [{ type: "organic", url: "https://rival.com/" }],
    billing: { path: ["serp"], costUsd: 0.01 },
  });
  extract.mockImplementation(usableExtraction);
  classify.mockImplementation(async (request: { requestId: string }) => ({
    v: 1,
    operation: "classify_competitors",
    requestId: request.requestId,
    status: "succeeded",
    output: {
      selections: [{ candidateId: crypto.randomUUID(), reason: "Foreign" }],
    },
    usage: {
      backendId: "openrouter",
      modelId: "actual",
      basis: "usd",
      costUsd: 0.01,
      inputTokens: 10,
      outputTokens: 2,
    },
  }));
  await runCompetitorResearch(id);
  const row = await repository.getRun(scope, "project", id);
  expect(row.run.outcome).toBe("unknown");
  expect(row.candidates[0]?.classification).toBe("pending");
  expect(
    row.operations.find((operation) => operation.slot === "classify")?.state,
  ).toBe("issued");
});

it("treats a read that redirects to another domain as unavailable evidence", async () => {
  const { id, scope } = await admitted();
  search.mockResolvedValueOnce({
    data: [{ type: "organic", url: "https://rival.com/" }],
    billing: { path: ["serp"], costUsd: 0.01 },
  });
  extract.mockImplementation(async (input: { requestedUrl: string }) => ({
    ...usableExtraction(input),
    resolvedUrl: "https://foreign.com/",
  }));
  await runCompetitorResearch(id);
  const row = await repository.getRun(scope, "project", id);
  expect(row.run.outcome).toBe("unavailable");
  expect(row.candidates[0]?.classification).toBe("unreadable");
  expect(classify).not.toHaveBeenCalled();
});

it("preserves unknown billing without replaying settlement", async () => {
  const { id, scope } = await admitted();
  billing.mockResolvedValueOnce({ status: "unknown" });
  await runCompetitorResearch(id);
  expect((await repository.getRun(scope, "project", id)).run.billingState).toBe(
    "unknown",
  );
  await runCompetitorResearch(id);
  expect(billing).toHaveBeenCalledTimes(1);
});

it("leaves zero-cost work without a billing submission", async () => {
  const { id, scope } = await admitted();
  search.mockResolvedValueOnce({
    data: [],
    billing: { path: ["serp"], costUsd: 0 },
  });
  await runCompetitorResearch(id);
  expect((await repository.getRun(scope, "project", id)).run.billingState).toBe(
    "not_started",
  );
  expect(billing).not.toHaveBeenCalled();
});

it("retains and settles a known charged search failure", async () => {
  const { id, scope } = await admitted();
  search.mockRejectedValueOnce(
    new DataforseoChargedTaskError("provider failed", {
      path: ["serp"],
      costUsd: 0.04,
    }),
  );
  await runCompetitorResearch(id);
  const row = await repository.getRun(scope, "project", id);
  expect(row.run.outcome).toBe("unavailable");
  expect(
    row.operations.find((operation) => operation.slot === "search_0"),
  ).toMatchObject({ state: "failed", costUsd: 0.04 });
  expect(billing).toHaveBeenCalledTimes(1);
});

it.each([
  ["membership removal", "delete from member where id='membership'"],
  ["role change", "update member set role='member' where id='membership'"],
])(
  "settles known search cost once after %s during a page",
  async (_name, mutation) => {
    const { id } = await admitted();
    search.mockResolvedValueOnce({
      data: [
        { type: "organic", url: "https://rival.com/" },
        { type: "organic", url: "https://other.com/" },
      ],
      billing: { path: ["serp"], costUsd: 0.02 },
    });
    extract.mockImplementation(async (input: { requestedUrl: string }) => {
      await testDb.execute(mutation);
      return usableExtraction(input);
    });
    billing.mockResolvedValueOnce({ status: "unknown" });

    await runCompetitorResearch(id);
    const [run] = await testDb.execute(
      `select outcome,billing_state from project_competitor_research_runs where id='${id}'`,
    );
    expect(run).toMatchObject({ outcome: "unknown", billing_state: "unknown" });
    expect(search).toHaveBeenCalledTimes(1);
    expect(extract).toHaveBeenCalledTimes(1);
    expect(classify).not.toHaveBeenCalled();
    expect(billing).toHaveBeenCalledExactlyOnceWith(
      {
        userId: actor.userId,
        userEmail: actor.userEmail,
        organizationId: actor.organizationId,
        projectId: "project",
      },
      [
        {
          provider: "dataforseo",
          creditFeature: "keyword_research",
          operation: "competitor_research_serp",
          costUsd: 0.02,
        },
      ],
    );
    await runCompetitorResearch(id);
    expect(billing).toHaveBeenCalledTimes(1);
  },
);
