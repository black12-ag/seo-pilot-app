import { afterAll, beforeEach, expect, it, vi } from "vitest";
import type * as Ai from "ai";
import type * as Serp from "@/server/lib/dataforseo/serp";
import {
  aiInput,
  directInput,
  PROJECT_ID,
  customer,
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
  betterAuth,
  openRouterAccess,
} = await vi.hoisted(async () => ({
  ...(await (
    await import("./websiteResearchExecutionTestDb")
  ).createWebsiteResearchExecutionTestDb()),
  betterAuth: vi.fn(async () => true),
  openRouterAccess: vi.fn((): { apiKey: string } | null => ({
    apiKey: "test",
  })),
}));
vi.mock("cloudflare:workers", () => ({
  env: { DATABASE_PROVIDER: testDb.provider, AI_VISIBILITY_WORKFLOW: workflow },
  waitUntil: vi.fn(),
}));
vi.mock("@/db", () => ({ db: testDb.db }));
vi.mock("@/db/runBatch", () => ({ runBatch: testDb.runBatch }));
vi.mock("@/server/lib/runtime-env", () => ({
  usesBetterAuthServer: betterAuth,
  isHostedServerAuthMode: async () => false,
  getWorkersEnv: async () => ({}),
  getOptionalEnvValue: async () => null,
}));
vi.mock("@/server/lib/openrouter", () => ({
  getOpenRouterAccess: openRouterAccess,
  requireOpenRouterAccess: async () => {
    const access = openRouterAccess();
    if (!access) throw new Error("Missing required environment variable");
    return access;
  },
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

import { CompetitorResearchRepository } from "@/server/features/competitor-research/repositories/CompetitorResearchRepository";
import {
  getAiResearchAttemptSetup,
  startAiResearchAttemptSetup,
} from "@/server/features/ai-visibility/services/aiResearchKeywords";
import { WebsiteResearchAttemptRepository as attempts } from "../repositories/WebsiteResearchAttemptRepository";
import { actor } from "../repositories/websiteResearchAttemptTestDb";
import { ProjectWebsiteService } from "./ProjectWebsiteService";
import { WebsiteResearchAttemptService as service } from "./WebsiteResearchAttemptService";
import { executeWebsiteResearchAttempt as execute } from "./websiteResearchAttemptExecution";

beforeEach(async () => {
  betterAuth.mockResolvedValue(true);
  openRouterAccess.mockReturnValue({ apiKey: "test" });
  await seed();
});
afterAll(testDb.close);

const attemptRow = async (id: string) =>
  (
    await testDb.execute(
      `select state,reason,active_project_id from project_website_research_attempts where id='${id}'`,
    )
  )[0];
function gate() {
  let open!: () => void;
  const opened = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { opened, open };
}
async function admit(mode: "direct" | "ai_setup" = "direct") {
  const input = directInput();
  const { scope, snapshot } = await CompetitorResearchRepository.getSnapshot(
    actor,
    PROJECT_ID,
  );
  const admitted = await attempts.admit(scope, {
    id: input.requestId,
    projectId: PROJECT_ID,
    mode,
    requestedWebsite: input.website,
    runSeededTracking: false,
    snapshot,
    nowMs: Date.now(),
  });
  if (admitted.kind !== "created") throw new Error(admitted.kind);
  return { input, token: admitted.admissionToken };
}
function holdModel() {
  const inModel = gate();
  const release = gate();
  const real = generateText.getMockImplementation()!;
  generateText.mockImplementation(async (options: never) => {
    inModel.open();
    await release.opened;
    // oxlint-disable-next-line typescript/no-unsafe-return -- the shared mock is untyped
    return real(options);
  });
  return { inModel, release };
}

it("a failed read after a finished run leaves its review readable by request ID", async () => {
  const input = directInput();
  const real = attempts.get;
  const spy = vi
    .spyOn(attempts, "get")
    .mockRejectedValueOnce(new Error("transient database error"));
  await expect(service.startDirect(input, customer, { actor })).rejects.toThrow(
    "transient database error",
  );
  spy.mockImplementation(real);
  expect((await attemptRow(input.requestId))?.state).toBe("review_ready");
  const replay = await service.startDirect(input, customer, { actor });
  expect(replay.status).toBe("review_ready");
  expect(generateText).toHaveBeenCalledTimes(1);
});

it("a missing model key fails plainly and frees the project without a charge warning", async () => {
  openRouterAccess.mockReturnValue(null);
  const input = directInput();
  const result = await service.startDirect(input, customer, { actor });
  expect(result).toMatchObject({
    status: "failed",
    failure: "model_not_configured",
  });
  expect(await attemptRow(input.requestId)).toMatchObject({
    active_project_id: null,
  });
  expect(readSite).not.toHaveBeenCalled();
  expect(generateText).not.toHaveBeenCalled();
});

it("a saved AI review leaves setup ready instead of showing the review again", async () => {
  await testDb.execute(
    `update projects set domain='example.com' where id='${PROJECT_ID}'`,
  );
  const input = aiInput();
  await startAiResearchAttemptSetup(input, customer, { actor });
  await execute(input.requestId);
  const { review } = await getAiResearchAttemptSetup(PROJECT_ID, actor);
  if (!review) throw new Error("review expected");
  await ProjectWebsiteService.save(
    { ...review, projectId: PROJECT_ID },
    customer,
    "user",
    { actor, runSeededTracking: false },
  );
  expect((await getAiResearchAttemptSetup(PROJECT_ID, actor)).status).toBe(
    "ready",
  );
});

it("a project set up after a failed AI attempt reads ready and starts no paid run", async () => {
  await testDb.execute(
    `update projects set domain='example.com' where id='${PROJECT_ID}'`,
  );
  readSite.mockResolvedValue({ pages: [] });
  const failed = aiInput();
  await startAiResearchAttemptSetup(failed, customer, { actor });
  await execute(failed.requestId);
  expect(await getAiResearchAttemptSetup(PROJECT_ID, actor)).toMatchObject({
    status: "failed",
    failure: "website_unreadable",
  });
  await testDb.execute(
    `update projects set ai_research_keywords='["seo software"]' where id='${PROJECT_ID}'`,
  );
  expect((await getAiResearchAttemptSetup(PROJECT_ID, actor)).status).toBe(
    "ready",
  );
  const next = aiInput();
  const started = await startAiResearchAttemptSetup(next, customer, { actor });
  expect(started.status).toBe("ready");
  expect(workflow.create).toHaveBeenCalledTimes(1);
});

it("a failed read during a poll leaves a healthy run alone", async () => {
  const { input, token } = await admit();
  const { inModel, release } = holdModel();
  const winner = execute(input.requestId, token);
  await inModel.opened;
  const real = CompetitorResearchRepository.getSnapshot;
  let calls = 0;
  const spy = vi
    .spyOn(CompetitorResearchRepository, "getSnapshot")
    .mockImplementation(async (...args) => {
      calls += 1;
      if (calls === 2) throw new Error("transient database error");
      return real(...args);
    });
  await expect(service.get(actor, PROJECT_ID, input.requestId)).rejects.toThrow(
    "transient database error",
  );
  spy.mockRestore();
  expect((await attemptRow(input.requestId))?.state).toBe("running");
  release.open();
  await winner;
  expect((await attemptRow(input.requestId))?.state).toBe("review_ready");
});

it("an attempt that lost authority before its claim frees the project", async () => {
  const { input, token } = await admit("ai_setup");
  await testDb.execute(`update member set role='admin' where id='membership'`);
  await execute(input.requestId, token);
  expect(await attemptRow(input.requestId)).toMatchObject({
    state: "failed",
    active_project_id: null,
  });
});

it("a new start replaces an attempt held past its deadline", async () => {
  const { input } = await admit("ai_setup");
  await testDb.execute(
    `update project_website_research_attempts set deadline_at_ms=created_at_ms+1 where id='${input.requestId}'`,
  );
  const next = directInput();
  await service.admitAi(next, customer, { actor });
  expect(await attemptRow(input.requestId)).toMatchObject({
    state: "failed",
    reason: "deadline",
    active_project_id: null,
  });
  expect((await attemptRow(next.requestId))?.active_project_id).toBe(
    PROJECT_ID,
  );
});

it("a poll holding a stale read can't block a run that has started", async () => {
  const { input, token } = await admit();
  const { inModel, release } = holdModel();
  const viewerHolding = gate();
  const realAuthority = attempts.getAuthority;
  let first = true;
  const spy = vi
    .spyOn(attempts, "getAuthority")
    .mockImplementation(async (...args) => {
      if (!first) return realAuthority(...args);
      first = false;
      viewerHolding.open();
      await inModel.opened;
      return null;
    });
  const viewer = service.get(actor, PROJECT_ID, input.requestId);
  await viewerHolding.opened;
  const winner = execute(input.requestId, token);
  await viewer;
  const [run] = await testDb.execute(
    `select state,outcome from project_competitor_research_runs where request_id='${input.requestId}'`,
  );
  expect(run?.outcome ?? null).not.toBe("blocked");
  release.open();
  await winner;
  spy.mockRestore();
});

it("a legacy review already saved no longer holds the project", async () => {
  await seedSavedContext();
  await testDb.execute(
    `update projects set legacy_setup_absence_proven=0 where id='${PROJECT_ID}'`,
  );
  const review = {
    name: "Example",
    domain: "example.com",
    overview: "Old review",
    competitors: [],
    preserveCompetitors: false,
    suggestedTopics: [],
  };
  workflow.get.mockResolvedValue({
    status: async () => ({ status: "complete", output: { review } }),
  });
  const result = await service.startDirect(directInput(), customer, { actor });
  expect(result.status).not.toBe("legacy_review");
});

it("needs a confirmed request ID under Better Auth", async () => {
  await expect(
    ProjectWebsiteService.startResearch(
      { projectId: PROJECT_ID, website: "https://example.com" },
      customer,
      { actor },
    ),
  ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  expect(
    await testDb.execute("select id from project_website_research_attempts"),
  ).toHaveLength(0);
});
