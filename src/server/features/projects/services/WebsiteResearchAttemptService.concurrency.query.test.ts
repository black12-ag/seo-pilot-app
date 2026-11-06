import { afterAll, beforeEach, expect, it, vi } from "vitest";
import type * as Ai from "ai";
import type * as Serp from "@/server/lib/dataforseo/serp";
import {
  aiInput,
  customer,
  directInput,
  PROJECT_ID,
} from "./websiteResearchExecutionTestDb";

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
vi.mock("@/server/lib/provider-access", () => ({
  hasDataforseoAccess: async () => true,
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

import { startAiResearchAttemptSetup } from "@/server/features/ai-visibility/services/aiResearchKeywords";
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

const attemptRow = async (id: string) =>
  (
    await testDb.execute(
      `select state,reason,execution_token from project_website_research_attempts where id='${id}'`,
    )
  )[0];
const claimExecution = async (id: string) => {
  const authority = await WebsiteResearchAttemptRepository.getAuthority(
    id,
    Date.now(),
  );
  if (!authority) throw new Error("expected authority");
  const claim = await WebsiteResearchAttemptRepository.claimExecution(
    authority.scope,
    id,
    authority.row.admissionToken,
    Date.now(),
  );
  if (claim.kind !== "claimed") throw new Error("expected claim");
};
const useProjectDomain = () =>
  testDb.execute(
    `update projects set domain='example.com' where id='${PROJECT_ID}'`,
  );
const statusUnavailable = () =>
  workflow.get.mockRejectedValue(new Error("status temporarily unavailable"));

it("launches one Workflow from duplicate starts, whose status is unavailable", async () => {
  await useProjectDomain();
  await testDb.execute(
    `update projects set legacy_setup_absence_proven=0 where id='${PROJECT_ID}'`,
  );
  // Both starts pass the pre-admission reads before either admits.
  let waiting = 0;
  let bothRead!: () => void;
  const bothReading = new Promise<void>((resolve) => {
    bothRead = resolve;
  });
  workflow.get.mockImplementation(async (id: string) => {
    if (id !== `ai-research-setup-${PROJECT_ID}`)
      throw new Error("status temporarily unavailable");
    return {
      status: async () => {
        if (++waiting === 2) bothRead();
        await bothReading;
        return { status: "complete", output: { review: null } };
      },
    };
  });
  let finishCreate!: () => void;
  const createHeld = new Promise<void>((resolve) => {
    finishCreate = resolve;
  });
  workflow.create.mockImplementation(() => createHeld);
  const input = aiInput();
  const starts = [
    startAiResearchAttemptSetup(input, customer, { actor }),
    startAiResearchAttemptSetup(input, customer, { actor }),
  ];
  try {
    // The duplicate answers while the launcher's create is still in flight.
    expect((await Promise.race(starts)).status).toBe("running");
    expect(await attemptRow(input.requestId)).toMatchObject({
      state: "admitted",
      reason: null,
    });
  } finally {
    finishCreate();
  }
  await Promise.all(starts);
  expect(workflow.create).toHaveBeenCalledOnce();
  expect(await attemptRow(input.requestId)).toMatchObject({
    state: "admitted",
    reason: null,
  });
});

it("keeps a claimed run when create's reply is lost and status is unavailable", async () => {
  await useProjectDomain();
  const input = aiInput();
  workflow.create.mockImplementation(
    async ({ params }: { params: { setupAttemptId: string } }) => {
      await claimExecution(params.setupAttemptId);
      statusUnavailable();
      throw new Error("reply lost");
    },
  );
  const result = await startAiResearchAttemptSetup(input, customer, { actor });
  expect(result.status).toBe("running");
  const row = await attemptRow(input.requestId);
  expect(row).toMatchObject({ state: "running", reason: null });
  expect(row.execution_token).toEqual(expect.any(String));
  expect(generateText).not.toHaveBeenCalled();
});

it("closes an unclaimed launch that nothing can confirm", async () => {
  await useProjectDomain();
  const input = aiInput();
  workflow.create.mockImplementation(async () => {
    statusUnavailable();
    throw new Error("reply lost");
  });
  const result = await startAiResearchAttemptSetup(input, customer, { actor });
  expect(result.status).toBe("failed");
  expect(await attemptRow(input.requestId)).toMatchObject({
    state: "unknown",
    reason: "launch_unconfirmed",
  });
});
