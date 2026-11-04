import { afterAll, beforeEach, expect, it, vi } from "vitest";
import type * as Ai from "ai";
import type * as Serp from "@/server/lib/dataforseo/serp";
import { directInput, PROJECT_ID } from "./websiteResearchExecutionTestDb";

const { testDb, generateText, readSite, search, bill, workflow, seed } =
  await vi.hoisted(async () =>
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
  getOptionalEnvValue: async () => null,
}));
vi.mock("@/server/lib/openrouter", () => ({
  getOpenRouterAccess: () => ({ apiKey: "test" }),
  requireOpenRouterAccess: async () => ({ apiKey: "test" }),
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
import { WebsiteResearchAttemptRepository } from "../repositories/WebsiteResearchAttemptRepository";
import { executeWebsiteResearchAttempt } from "./websiteResearchAttemptExecution";
import { actor } from "../repositories/websiteResearchAttemptTestDb";

beforeEach(seed);
afterAll(testDb.close);

it("only the claimed executor can finish and bill after setup reservation commits", async () => {
  const input = directInput();
  const { scope, snapshot } = await CompetitorResearchRepository.getSnapshot(
    actor,
    PROJECT_ID,
  );
  const admission = await WebsiteResearchAttemptRepository.admit(scope, {
    id: input.requestId,
    projectId: PROJECT_ID,
    mode: "direct",
    requestedWebsite: input.website,
    runSeededTracking: false,
    snapshot,
    nowMs: Date.now(),
  });
  if (admission.kind !== "created") throw new Error("expected admission");
  const realAdmit = CompetitorResearchRepository.admitSetup;
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let signal!: () => void;
  const created = new Promise<void>((resolve) => {
    signal = resolve;
  });
  const spy = vi
    .spyOn(CompetitorResearchRepository, "admitSetup")
    .mockImplementation(async (...args) => {
      const result = await realAdmit(...args);
      if (result.kind === "created") {
        signal();
        await held;
      }
      return result;
    });
  const winner = executeWebsiteResearchAttempt(
    input.requestId,
    admission.admissionToken,
  );
  try {
    await created;
    expect(generateText).not.toHaveBeenCalled();
    expect(readSite).not.toHaveBeenCalled();
    await executeWebsiteResearchAttempt(
      input.requestId,
      admission.admissionToken,
    );
    expect(
      await testDb.execute(
        `select state from project_website_research_attempts where id='${input.requestId}'`,
      ),
    ).toMatchObject([{ state: "running" }]);
    expect(bill).not.toHaveBeenCalled();
  } finally {
    release();
    try {
      await winner;
    } finally {
      spy.mockRestore();
    }
  }
  const rows = await testDb.execute(
    `select state,competitor_run_id,review_snapshot_json from project_website_research_attempts where id='${input.requestId}'`,
  );
  expect(rows).toMatchObject([{ state: "review_ready" }]);
  expect(typeof rows[0].competitor_run_id).toBe("string");
  expect(typeof rows[0].review_snapshot_json).toBe("string");
  expect(generateText).toHaveBeenCalledTimes(1);
  expect(bill).toHaveBeenCalledTimes(1);
});
