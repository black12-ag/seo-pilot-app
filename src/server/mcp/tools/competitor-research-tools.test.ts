import { afterAll, beforeEach, expect, it, vi } from "vitest";

const { testDb, launch } = await vi.hoisted(async () => {
  const { createCompetitorResearchTestDb } =
    await import("../../features/competitor-research/services/competitorResearchTestDb");
  return {
    testDb: await createCompetitorResearchTestDb(),
    launch: vi.fn(async (..._args: unknown[]) => undefined),
  };
});
vi.mock("cloudflare:workers", () => ({
  DurableObject: class {
    kind = "mock";
  },
  env: {
    DATABASE_PROVIDER: testDb.provider,
    AI_VISIBILITY_WORKFLOW: {
      get: async () => {
        throw new Error("missing");
      },
    },
  },
}));
vi.mock("@/db", () => ({ db: testDb.db }));
vi.mock("@/db/runBatch", () => ({ runBatch: testDb.runBatch }));
vi.mock("@/server/lib/runtime-env", () => ({
  usesBetterAuthServer: async () => true,
  isHostedServerAuthMode: async () => false,
  getOptionalEnvValue: async () => undefined,
  getWorkersEnv: async () => ({}),
}));
vi.mock("@/server/lib/provider-access", () => ({
  hasDataforseoAccess: async () => true,
}));
vi.mock("@/server/lib/openrouter", () => ({
  resolveAiAccess: async () => (() => ({ apiKey: "test" }))(),
  buildChatAgentModel: () => ({ modelId: "test-model" }),
}));
vi.mock("@/server/lib/startWorkflow", () => ({ startWorkflow: launch }));

import {
  COMPETITOR_TEST_PROJECT_ID as projectId,
  seedCompetitorProject,
} from "@/server/features/competitor-research/services/competitorResearchTestDb";
import { makeToolContext } from "./tool-test-support";
import { registerSeoPilotTools } from "../server";
import { buildSamMcpTools } from "@/server/features/sam/samChatTools";
import {
  getCompetitorResearchTool,
  startCompetitorResearchTool,
  getCompetitorResearchRunTool,
  acceptCompetitorResearchTool,
} from "./competitor-research-tools";

const context = makeToolContext({
  userId: "user",
  userEmail: "authority@example.com",
  organizationId: "organization",
  role: "owner",
  clientId: "api_key",
});
beforeEach(() => seedCompetitorProject(testDb));
afterAll(testDb.close);

it("registers the same four tools on MCP and SAM without a model-supplied project ID", () => {
  const names: string[] = [];
  registerSeoPilotTools((tool) => {
    names.push(tool.name);
  });
  const sam = buildSamMcpTools(context.auth, {
    id: projectId,
    domain: "example.com",
  });
  for (const name of [
    "get_competitor_research",
    "start_competitor_research",
    "get_competitor_research_run",
    "accept_competitor_research",
  ]) {
    expect(names).toContain(name);
    expect(sam[name]?.inputSchema).toBeDefined();
  }
});

it("reads readiness with the frozen MCP output and no paid work", async () => {
  const tool = getCompetitorResearchTool("mcp");
  const response = await tool.handler({ projectId }, context);
  const state = tool.config.outputSchema.parse(response.structuredContent);
  expect(state).toMatchObject({
    projectId,
    ready: true,
    limits: { maxQueries: 2, maxPages: 6, maxModelCalls: 1 },
    meta: { projectId },
  });
  expect(launch).not.toHaveBeenCalled();
  expect(
    await testDb.execute("select id from project_competitor_research_runs"),
  ).toHaveLength(0);
});

it("denies a project outside the credential-bound organization before service work", async () => {
  const outsider = makeToolContext({
    userId: "user",
    userEmail: "authority@example.com",
    organizationId: "foreign",
    role: "owner",
    clientId: "api_key",
  });
  await expect(
    getCompetitorResearchTool("mcp").handler({ projectId }, outsider),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
  expect(launch).not.toHaveBeenCalled();
});

it("starts only confirmed work for the credential-bound organization and keeps foreign IDs private", async () => {
  const state = getCompetitorResearchTool("mcp").config.outputSchema.parse(
    (await getCompetitorResearchTool("mcp").handler({ projectId }, context))
      .structuredContent,
  );
  const start = startCompetitorResearchTool("mcp");
  const input = {
    projectId,
    requestId: crypto.randomUUID(),
    expectedContextVersion: state.contextVersion,
    contextHash: state.contextHash,
    capabilityFingerprint: state.capabilityFingerprint,
    confirmedPaidWork: true as const,
  };
  expect(
    start.config.inputSchema.safeParse({ ...input, confirmedPaidWork: false })
      .success,
  ).toBe(false);
  expect(
    start.config.inputSchema.safeParse({
      ...input,
      sourceUrl: "https://forged.com",
    }).success,
  ).toBe(false);
  const created = start.config.outputSchema.parse(
    (await start.handler(input, context)).structuredContent,
  );
  expect(created.ok).toBe(true);
  if (!created.ok) return;
  expect(
    await testDb.execute(
      `select sponsor_user_id,organization_id,surface from project_competitor_research_runs where id='${created.run.id}'`,
    ),
  ).toMatchObject([
    {
      sponsor_user_id: "user",
      organization_id: "organization",
      surface: "mcp",
    },
  ]);
  const runTool = getCompetitorResearchRunTool("mcp");
  expect(
    runTool.config.outputSchema.parse(
      (await runTool.handler({ projectId, runId: created.run.id }, context))
        .structuredContent,
    ),
  ).toMatchObject({ state: "available", run: { id: created.run.id } });
  await expect(
    runTool.handler({ projectId, runId: crypto.randomUUID() }, context),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
  const review = acceptCompetitorResearchTool("mcp");
  expect(
    review.config.inputSchema.safeParse({
      projectId,
      runId: created.run.id,
      mutationId: crypto.randomUUID(),
      expectedContextVersion: state.contextVersion,
      selections: [],
      domain: "forged.com",
    }).success,
  ).toBe(false);
  expect(
    review.config.outputSchema.parse(
      (
        await review.handler(
          {
            projectId,
            runId: created.run.id,
            mutationId: crypto.randomUUID(),
            expectedContextVersion: state.contextVersion,
            selections: [],
          },
          context,
        )
      ).structuredContent,
    ),
  ).toMatchObject({ ok: false, code: "run_not_ready" });
  expect(launch).toHaveBeenCalledTimes(1);
});

it("stamps the SAM surface from registration rather than model arguments", async () => {
  const state = getCompetitorResearchTool("sam").config.outputSchema.parse(
    (await getCompetitorResearchTool("sam").handler({ projectId }, context))
      .structuredContent,
  );
  const result = await startCompetitorResearchTool("sam").handler(
    {
      projectId,
      requestId: crypto.randomUUID(),
      expectedContextVersion: state.contextVersion,
      contextHash: state.contextHash,
      capabilityFingerprint: state.capabilityFingerprint,
      confirmedPaidWork: true,
    },
    context,
  );
  const created = startCompetitorResearchTool("sam").config.outputSchema.parse(
    result.structuredContent,
  );
  expect(created.ok).toBe(true);
  if (created.ok)
    expect(
      await testDb.execute(
        `select surface from project_competitor_research_runs where id='${created.run.id}'`,
      ),
    ).toMatchObject([{ surface: "sam" }]);
});
