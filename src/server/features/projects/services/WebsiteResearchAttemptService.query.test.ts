import { afterAll, beforeEach, expect, it, vi } from "vitest";
import type * as Ai from "ai";
import type * as Serp from "@/server/lib/dataforseo/serp";
import {
  customer,
  PROJECT_ID,
  topics,
  directInput,
  aiInput,
  type ResearchGenerateOptions,
} from "./websiteResearchExecutionTestDb";

const {
  testDb,
  generateText,
  readSite,
  search,
  bill,
  workflow,
  seed,
  seedSavedContext,
} = await vi.hoisted(async () =>
  (
    await import("./websiteResearchExecutionTestDb")
  ).createWebsiteResearchExecutionTestDb(),
);
vi.mock("cloudflare:workers", () => ({
  env: { DATABASE_PROVIDER: testDb.provider, AI_VISIBILITY_WORKFLOW: workflow },
  waitUntil: vi.fn(),
}));
vi.mock("@/db", () => ({ db: testDb.db }));
vi.mock("@/db/runBatch", () => ({ runBatch: testDb.runBatch }));
vi.mock("@/server/lib/runtime-env", () => ({
  usesBetterAuthServer: async () => true,
  isHostedServerAuthMode: async () => false,
  getWorkersEnv: async () => ({}),
  getOptionalEnvValue: async (name: string) =>
    name === "DATAFORSEO_API_KEY" ? "key" : null,
}));
vi.mock("@/server/lib/openrouter", () => ({
  resolveAiAccess: async () => (() => ({ apiKey: "test" }))(),
  requireAiAccess: async () => ({ apiKey: "test" }),
  buildChatAgentModel: () => ({ modelId: "test-model" }),
}));
vi.mock("ai", async (importOriginal) => ({
  NoObjectGeneratedError: (await importOriginal<typeof Ai>())
    .NoObjectGeneratedError,
  generateText,
  Output: { object: (schema: unknown) => schema },
  stepCountIs: vi.fn(),
  tool: (value: unknown) => value,
}));
vi.mock("@/server/lib/scrape", () => ({ readSite }));
vi.mock("@/server/lib/dataforseo/serp", async (importOriginal) => ({
  ...(await importOriginal<typeof Serp>()),
  fetchLiveSerp: search,
}));
vi.mock("@/server/lib/chatAgent", () => ({
  requireOpenRouterCostUsd: () => 0.03,
}));
vi.mock("@/server/billing/researchSpend", () => ({ billResearchSpend: bill }));

import { ProjectWebsiteService } from "./ProjectWebsiteService";
import { WebsiteResearchAttemptService } from "./WebsiteResearchAttemptService";
import { WebsiteResearchAttemptRepository } from "../repositories/WebsiteResearchAttemptRepository";
import { executeWebsiteResearchAttempt } from "./websiteResearchAttemptExecution";
import { CompetitorResearchRepository } from "@/server/features/competitor-research/repositories/CompetitorResearchRepository";
import { publicCompetitorRun } from "@/server/features/competitor-research/services/competitorResearchView";
import {
  startAiResearchAttemptSetup,
  getAiResearchAttemptSetup,
} from "@/server/features/ai-visibility/services/aiResearchKeywords";
import { actor } from "../repositories/websiteResearchAttemptTestDb";

beforeEach(seed);
afterAll(testDb.close);

it("persists the final read page, whole review, cost, and exact ID replay", async () => {
  const input = directInput();
  const first = await ProjectWebsiteService.researchAttempt(input, customer, {
    actor,
  });
  expect(first.status).toBe("review_ready");
  expect(first.review?.competitors[0]?.researchCandidateId).not.toBe(
    "00000000-0000-4000-8000-000000000099",
  );
  expect(
    await ProjectWebsiteService.researchAttempt(input, customer, { actor }),
  ).toEqual(first);
  expect(generateText).toHaveBeenCalledTimes(1);
  expect(readSite).toHaveBeenCalledTimes(2);
  expect(bill).toHaveBeenCalledTimes(1);
  const receipt = await testDb.execute(
    `select snapshot_domain,requested_domain,review_snapshot_json from project_website_research_attempts where id='${input.requestId}'`,
  );
  expect(receipt).toMatchObject([
    {
      snapshot_domain: null,
      requested_domain: "example.com",
    },
  ]);
  expect(typeof receipt[0].review_snapshot_json).toBe("string");
  const source = await testDb.execute(
    "select source_url,source_excerpt,source_hash,source_captured_at_ms from project_competitor_research_candidates",
  );
  expect(source).toMatchObject([
    {
      source_url: "https://rival.com/about",
      source_excerpt: "Rival sells SEO software.",
    },
  ]);
  expect(source[0].source_hash).toMatch(/^[0-9a-f]{64}$/);
  expect(Number.isSafeInteger(Number(source[0].source_captured_at_ms))).toBe(
    true,
  );
  const { scope } = await CompetitorResearchRepository.getSnapshot(
    actor,
    PROJECT_ID,
  );
  const run = await CompetitorResearchRepository.getRun(
    scope,
    PROJECT_ID,
    first.review!.competitorResearchRunId!,
  );
  expect(publicCompetitorRun(run)).toMatchObject({
    knownCostUsd: 0.04,
    costComplete: true,
    billingState: "unknown",
  });
  await expect(
    ProjectWebsiteService.researchAttempt(
      { ...input, website: "https://changed.com" },
      customer,
      { actor },
    ),
  ).rejects.toMatchObject({ code: "CONFLICT" });
});

it("blocks a busy competitor run before any provider call", async () => {
  const { scope, snapshot } = await CompetitorResearchRepository.getSnapshot(
    actor,
    PROJECT_ID,
  );
  expect(
    (
      await CompetitorResearchRepository.admitSetup(scope, {
        id: crypto.randomUUID(),
        projectId: PROJECT_ID,
        requestId: crypto.randomUUID(),
        requestHash: "a".repeat(64),
        snapshot,
        businessSummary: "",
        modelBackendId: "openrouter",
        modelConfigurationHash: "b".repeat(64),
        nowMs: Date.now(),
        deadlineAtMs: Date.now() + 300000,
      })
    ).kind,
  ).toBe("created");
  const input = directInput();
  const result = await WebsiteResearchAttemptService.startDirect(
    input,
    customer,
    { actor },
  );
  expect(result.status).toBe("failed");
  expect(generateText).not.toHaveBeenCalled();
});

it("launches one AI Workflow with the caller ID and recovers the DB receipt", async () => {
  await testDb.execute(
    `update projects set domain='example.com' where id='${PROJECT_ID}'`,
  );
  const input = aiInput();
  const first = await startAiResearchAttemptSetup(input, customer, { actor });
  expect(first.status).toBe("running");
  expect(first.attemptId).toBe(input.requestId);
  expect(workflow.create).toHaveBeenCalledExactlyOnceWith({
    id: `ai-research-setup-${input.requestId}`,
    params: { setupAttemptId: input.requestId },
  });
  expect(
    (await startAiResearchAttemptSetup(input, customer, { actor })).attemptId,
  ).toBe(input.requestId);
  expect(workflow.create).toHaveBeenCalledTimes(1);
  expect(generateText).not.toHaveBeenCalled();
  expect((await getAiResearchAttemptSetup(PROJECT_ID, actor)).attemptId).toBe(
    input.requestId,
  );
  const { scope } = await CompetitorResearchRepository.getSnapshot(
    actor,
    PROJECT_ID,
  );
  const row = await WebsiteResearchAttemptRepository.get(
    scope,
    PROJECT_ID,
    input.requestId,
  );
  expect(
    (
      await WebsiteResearchAttemptRepository.claimExecution(
        scope,
        input.requestId,
        row.admissionToken,
        Date.now(),
      )
    ).kind,
  ).toBe("claimed");
  await executeWebsiteResearchAttempt(input.requestId);
  expect(bill).not.toHaveBeenCalled();
  await expect(
    startAiResearchAttemptSetup(input, customer, {
      actor,
      runSeededTracking: true,
    }),
  ).rejects.toMatchObject({ code: "CONFLICT" });
});

it("recovers the AI full review from SQL after Workflow output is lost", async () => {
  await testDb.execute(
    `update projects set domain='example.com' where id='${PROJECT_ID}'`,
  );
  const input = aiInput();
  await startAiResearchAttemptSetup(input, customer, { actor });
  expect(await executeWebsiteResearchAttempt(input.requestId)).toEqual({
    attemptId: input.requestId,
  });
  const recovered = await getAiResearchAttemptSetup(PROJECT_ID, actor);
  expect(recovered.status).toBe("review");
  expect(recovered.review?.competitors[0]?.researchCandidateId).toMatch(
    /^[0-9a-f-]{36}$/,
  );
  expect(recovered.review?.websiteResearchAttemptId).toBe(input.requestId);
  expect(await executeWebsiteResearchAttempt(input.requestId)).toEqual({
    attemptId: input.requestId,
  });
  expect(generateText).toHaveBeenCalledTimes(1);
  expect(bill).toHaveBeenCalledTimes(1);
});

it("commits AI topics only under the original attempt without a competitor run", async () => {
  await testDb.execute(
    `update projects set domain='example.com' where id='${PROJECT_ID}'`,
  );
  await seedSavedContext();
  generateText.mockImplementation(
    async (options: {
      onStepFinish: (x: { providerMetadata: object }) => void;
    }) => {
      options.onStepFinish({ providerMetadata: {} });
      return {
        output: {
          suggestedTopics: topics,
          suggestedKeywords: ["seo software"],
        },
      };
    },
  );
  const input = aiInput();
  await startAiResearchAttemptSetup(input, customer, { actor });
  await executeWebsiteResearchAttempt(input.requestId);
  expect((await getAiResearchAttemptSetup(PROJECT_ID, actor)).status).toBe(
    "ready",
  );
  expect(
    await testDb.execute("select id from project_competitor_research_runs"),
  ).toHaveLength(0);
  expect(
    await testDb.execute(
      `select state from project_website_research_attempts where id='${input.requestId}'`,
    ),
  ).toMatchObject([{ state: "finished_no_review" }]);
  const project = await testDb.execute(
    `select ai_research_keywords from projects where id='${PROJECT_ID}'`,
  );
  expect(project[0].ai_research_keywords).toContain("SEO");
  await executeWebsiteResearchAttempt(input.requestId);
  expect(generateText).toHaveBeenCalledTimes(1);
  expect(bill).toHaveBeenCalledTimes(1);
});

it("treats a lost Workflow create reply as the same running instance", async () => {
  await testDb.execute(
    `update projects set domain='example.com' where id='${PROJECT_ID}'`,
  );
  const input = aiInput();
  workflow.create.mockRejectedValue(new Error("reply lost"));
  workflow.get.mockImplementation(async (id: string) => {
    if (id === `ai-research-setup-${input.requestId}`)
      return { status: async () => ({ status: "running" }) };
    return {
      status: async () => ({ status: "complete", output: { review: null } }),
    };
  });
  expect(
    (await startAiResearchAttemptSetup(input, customer, { actor })).status,
  ).toBe("running");
  expect(
    (await startAiResearchAttemptSetup(input, customer, { actor })).status,
  ).toBe("running");
  expect(workflow.create).toHaveBeenCalledTimes(1);
});

it("does not admit paid AI work when legacy Workflow lookup is uncertain", async () => {
  await testDb.execute(
    `update projects set domain='example.com' where id='${PROJECT_ID}'`,
  );
  workflow.get.mockRejectedValue(new Error("lookup unavailable"));
  await expect(
    startAiResearchAttemptSetup(aiInput(), customer, { actor }),
  ).rejects.toMatchObject({ code: "UPSTREAM_UNAVAILABLE" });
  expect(
    await testDb.execute("select id from project_website_research_attempts"),
  ).toHaveLength(0);
  expect(workflow.create).not.toHaveBeenCalled();
  expect(generateText).not.toHaveBeenCalled();
});

it("stops new page reads after role revocation and bills observed work once", async () => {
  generateText.mockImplementation(async (options: ResearchGenerateOptions) => {
    await options.tools.search_competitors.execute({
      queries: ["seo software"],
    });
    await testDb.execute(
      "update member set role='admin' where id='membership'",
    );
    await options.tools.read_business_sites.execute({
      domains: ["rival.com"],
    });
    throw new Error("unreachable");
  });
  const input = directInput();
  await expect(
    ProjectWebsiteService.researchAttempt(input, customer, { actor }),
  ).rejects.toThrow();
  expect(readSite).toHaveBeenCalledTimes(1);
  expect(bill).toHaveBeenCalledTimes(1);
  expect(
    await testDb.execute(
      "select id from project_competitor_research_candidates",
    ),
  ).toHaveLength(0);
  expect(
    await testDb.execute(
      "select state,outcome from project_competitor_research_runs",
    ),
  ).toMatchObject([{ state: "finished", outcome: "unknown" }]);
  await testDb.execute("update member set role='owner' where id='membership'");
  expect(
    (await ProjectWebsiteService.researchAttempt(input, customer, { actor }))
      .status,
  ).toBe("unknown");
  expect(generateText).toHaveBeenCalledTimes(1);
  expect(bill).toHaveBeenCalledTimes(1);
});

it("drops an unreadable candidate instead of publishing a source reference", async () => {
  readSite.mockImplementation(async (url: string) => ({
    pages:
      url === "rival.com"
        ? [{ url: "https://rival.com/about", title: "Rival", text: " " }]
        : [
            {
              url: "https://example.com/start",
              title: "Example",
              text: "Example sells SEO software.",
            },
          ],
  }));
  const input = directInput();
  const result = await ProjectWebsiteService.researchAttempt(input, customer, {
    actor,
  });
  expect(result.review?.competitors).toEqual([]);
  expect(
    await testDb.execute(
      "select id from project_competitor_research_candidates",
    ),
  ).toHaveLength(0);
  expect(
    await testDb.execute(
      "select outcome from project_competitor_research_runs",
    ),
  ).toMatchObject([{ outcome: "partial" }]);
  expect(readSite).toHaveBeenCalledTimes(2);
});

it("stores a topics-only direct review without reserving a competitor run", async () => {
  await seedSavedContext();
  generateText.mockImplementation(
    async (options: {
      onStepFinish: (x: { providerMetadata: object }) => void;
    }) => {
      options.onStepFinish({ providerMetadata: {} });
      return {
        output: {
          suggestedTopics: topics,
          suggestedKeywords: ["seo software"],
        },
      };
    },
  );
  const input = directInput();
  const result = await ProjectWebsiteService.researchAttempt(input, customer, {
    actor,
  });
  expect(result.status).toBe("review_ready");
  expect(result.review?.preserveCompetitors).toBe(true);
  expect(result.review?.competitors).toEqual([]);
  expect(
    await testDb.execute("select id from project_competitor_research_runs"),
  ).toHaveLength(0);
});
