import { afterAll, beforeEach, expect, it, vi } from "vitest";
import type * as Ai from "ai";
import {
  customer,
  directInput,
  topics,
} from "./websiteResearchExecutionTestDb";

const {
  testDb,
  generateText,
  readSite,
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
  getOptionalEnvValue: async () => null,
}));
vi.mock("@/server/lib/provider-access", () => ({
  hasDataforseoAccess: async () => false,
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
vi.mock("@/server/lib/chatAgent", () => ({
  requireOpenRouterCostUsd: () => 0.03,
}));
vi.mock("@/server/billing/researchSpend", () => ({ billResearchSpend: bill }));

import { ProjectWebsiteService } from "./ProjectWebsiteService";
import { actor } from "../repositories/websiteResearchAttemptTestDb";

beforeEach(seed);
afterAll(testDb.close);

it("refuses before any model call or page read when competitor search can't run", async () => {
  await expect(
    ProjectWebsiteService.researchAttempt(directInput(), customer, { actor }),
  ).rejects.toMatchObject({ code: "DATAFORSEO_AUTH_FAILED" });
  expect(generateText).not.toHaveBeenCalled();
  expect(readSite).not.toHaveBeenCalled();
});

it("still researches a project whose competitors are saved", async () => {
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
  const result = await ProjectWebsiteService.researchAttempt(
    directInput(),
    customer,
    { actor },
  );
  expect(result.status).toBe("review_ready");
});
