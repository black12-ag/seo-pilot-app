import { afterAll, beforeEach, expect, it, vi } from "vitest";
import type { z } from "zod";

const { testDb, projectId, request, launch } = await vi.hoisted(async () => {
  const { createCompetitorResearchTestDb, COMPETITOR_TEST_PROJECT_ID } =
    await import("../server/features/competitor-research/services/competitorResearchTestDb");
  return {
    testDb: await createCompetitorResearchTestDb(),
    projectId: COMPETITOR_TEST_PROJECT_ID,
    request: {
      context: {
        userId: "user",
        userEmail: "authority@example.com",
        organizationId: "organization",
        role: "owner",
        projectId: COMPETITOR_TEST_PROJECT_ID,
      },
    },
    launch: vi.fn(async (..._args: unknown[]) => undefined),
  };
});
vi.mock("cloudflare:workers", () => ({
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
vi.mock("@/serverFunctions/middleware", () => ({ requireProjectContext: [] }));
vi.mock("@tanstack/react-start", () => ({
  createServerFn: () => ({
    middleware: () => ({
      validator: (schema: z.ZodType) => ({
        handler:
          (
            handler: (input: {
              data: unknown;
              context: typeof request.context;
            }) => unknown,
          ) =>
          async ({ data }: { data: unknown }) =>
            handler({ data: schema.parse(data), context: request.context }),
      }),
    }),
  }),
}));

import {
  COMPETITOR_TEST_PROJECT_ID,
  seedCompetitorProject,
} from "@/server/features/competitor-research/services/competitorResearchTestDb";
import {
  getCompetitorResearch,
  startCompetitorResearch,
  getCompetitorResearchRun,
  acceptCompetitorResearch,
} from "./competitorResearch";

beforeEach(() => seedCompetitorProject(testDb));
afterAll(testDb.close);

it("reads live readiness through the bound web actor without starting provider work", async () => {
  const state = await getCompetitorResearch({ data: { projectId } });
  expect(state.ready).toBe(true);
  expect(state.projectId).toBe(projectId);
  expect(launch).not.toHaveBeenCalled();
  expect(
    await testDb.execute("select id from project_competitor_research_runs"),
  ).toHaveLength(0);
});

it("rejects forged scope before durable admission", async () => {
  const state = await getCompetitorResearch({ data: { projectId } });
  const input = {
    projectId: crypto.randomUUID(),
    requestId: crypto.randomUUID(),
    expectedContextVersion: state.contextVersion,
    contextHash: state.contextHash,
    capabilityFingerprint: state.capabilityFingerprint,
    confirmedPaidWork: true as const,
  };
  await expect(startCompetitorResearch({ data: input })).rejects.toMatchObject({
    code: "NOT_FOUND",
  });
  const forged = { ...input, projectId, organizationId: "foreign" };
  await expect(startCompetitorResearch({ data: forged })).rejects.toThrow();
  expect(
    await testDb.execute("select id from project_competitor_research_runs"),
  ).toHaveLength(0);
  expect(launch).not.toHaveBeenCalled();
});

it("persists the transport-derived sponsor, returns the same DTO and refuses a foreign run", async () => {
  const state = await getCompetitorResearch({
    data: { projectId: COMPETITOR_TEST_PROJECT_ID },
  });
  const started = await startCompetitorResearch({
    data: {
      projectId,
      requestId: crypto.randomUUID(),
      expectedContextVersion: state.contextVersion,
      contextHash: state.contextHash,
      capabilityFingerprint: state.capabilityFingerprint,
      confirmedPaidWork: true,
    },
  });
  expect(started.ok).toBe(true);
  if (!started.ok) return;
  expect(
    await testDb.execute(
      `select sponsor_user_id,surface,organization_id from project_competitor_research_runs where id='${started.run.id}'`,
    ),
  ).toMatchObject([
    {
      sponsor_user_id: "user",
      surface: "web",
      organization_id: "organization",
    },
  ]);
  expect(
    (
      await getCompetitorResearchRun({
        data: { projectId, runId: started.run.id },
      })
    ).state,
  ).toBe("available");
  await expect(
    getCompetitorResearchRun({
      data: { projectId, runId: crypto.randomUUID() },
    }),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
  expect(
    await acceptCompetitorResearch({
      data: {
        projectId,
        runId: started.run.id,
        mutationId: crypto.randomUUID(),
        expectedContextVersion: state.contextVersion,
        selections: [],
      },
    }),
  ).toMatchObject({ ok: false, code: "run_not_ready" });
  expect(launch).toHaveBeenCalledTimes(1);
});
