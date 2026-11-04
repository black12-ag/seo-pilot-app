import { afterAll, beforeEach, expect, it, vi } from "vitest";

const { testDb, workflow, startWorkflow, modelAccess } = await vi.hoisted(
  async () => {
    const { createCompetitorResearchTestDb } =
      await import("./competitorResearchTestDb");
    return {
      testDb: await createCompetitorResearchTestDb(),
      workflow: {
        get: vi.fn(
          async (
            _id: string,
          ): Promise<{
            status: () => Promise<{ status: string; output?: unknown }>;
          }> => {
            throw new Error("unclassified Workflow failure");
          },
        ),
      },
      startWorkflow: vi.fn(async () => undefined),
      modelAccess: vi.fn(() => ({ apiKey: "test" })),
    };
  },
);
vi.mock("cloudflare:workers", () => ({
  env: { DATABASE_PROVIDER: testDb.provider, AI_VISIBILITY_WORKFLOW: workflow },
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
  resolveAiAccess: async () => modelAccess(),
  buildChatAgentModel: () => ({ modelId: "model-a" }),
}));
vi.mock("@/server/lib/startWorkflow", () => ({ startWorkflow }));

import { CompetitorResearchService as service } from "./CompetitorResearchService";
import {
  COMPETITOR_TEST_PROJECT_ID as projectId,
  seedCompetitorProject,
} from "./competitorResearchTestDb";

const actor = {
  userId: "user",
  userEmail: "authority@example.com",
  organizationId: "organization",
  role: "owner",
  surface: "web" as const,
};
async function request() {
  const state = await service.get(actor, projectId);
  return {
    projectId,
    requestId: crypto.randomUUID(),
    expectedContextVersion: state.contextVersion,
    contextHash: state.contextHash,
    capabilityFingerprint: state.capabilityFingerprint,
    confirmedPaidWork: true as const,
  };
}

beforeEach(async () => {
  await seedCompetitorProject(testDb);
  workflow.get.mockImplementation(async () => {
    throw new Error("unclassified Workflow failure");
  });
});
afterAll(testDb.close);

it("blocks an unproven project on unknown legacy lookup before run admission", async () => {
  const input = await request();
  await testDb.execute(
    `update projects set legacy_setup_absence_proven=0 where id='${projectId}'`,
  );
  await expect(service.start(actor, input)).rejects.toMatchObject({
    code: "UPSTREAM_UNAVAILABLE",
  });
  expect(workflow.get).toHaveBeenCalledWith(`ai-research-setup-${projectId}`);
  expect(startWorkflow).not.toHaveBeenCalled();
  expect(
    Number(
      (
        await testDb.execute(
          "select count(*) as n from project_competitor_research_runs",
        )
      )[0]?.n,
    ),
  ).toBe(0);
});

it("blocks an unproven project when a completed legacy review is unreadable", async () => {
  const input = await request();
  await testDb.execute(
    `update projects set legacy_setup_absence_proven=0 where id='${projectId}'`,
  );
  workflow.get.mockResolvedValue({
    status: async () => ({
      status: "complete",
      output: { review: { competitors: "corrupt" } },
    }),
  });
  await expect(service.start(actor, input)).rejects.toMatchObject({
    code: "UPSTREAM_UNAVAILABLE",
  });
  expect(startWorkflow).not.toHaveBeenCalled();
  expect(
    Number(
      (
        await testDb.execute(
          "select count(*) as n from project_competitor_research_runs",
        )
      )[0]?.n,
    ),
  ).toBe(0);
});

it("skips legacy lookup for a proven project and replays its exact receipt", async () => {
  const input = await request();
  const first = await service.start(actor, input);
  expect(first.ok).toBe(true);
  expect(
    workflow.get.mock.calls.some(
      ([id]) => id === `ai-research-setup-${projectId}`,
    ),
  ).toBe(false);
  await testDb.execute(
    `update projects set legacy_setup_absence_proven=0 where id='${projectId}'`,
  );
  const replay = await service.start(actor, input);
  expect(replay).toMatchObject({ ok: true, replayed: true });
  expect(
    workflow.get.mock.calls.some(
      ([id]) => id === `ai-research-setup-${projectId}`,
    ),
  ).toBe(false);
  expect(
    Number(
      (
        await testDb.execute(
          "select count(*) as n from project_competitor_research_runs",
        )
      )[0]?.n,
    ),
  ).toBe(1);
});

it("does not admit a new run while the old setup is running or awaiting review", async () => {
  const input = await request();
  await testDb.execute(
    `update projects set legacy_setup_absence_proven=0 where id='${projectId}'`,
  );
  workflow.get.mockResolvedValue({
    status: async () => ({ status: "waiting" }),
  });
  await expect(service.start(actor, input)).rejects.toMatchObject({
    code: "CONFLICT",
  });
  workflow.get.mockResolvedValue({
    status: async () => ({
      status: "complete",
      output: {
        review: {
          name: "Example",
          domain: "example.com",
          overview: "Example business",
          competitors: [],
          preserveCompetitors: false,
          suggestedTopics: [],
        },
      },
    }),
  });
  await expect(service.start(actor, input)).rejects.toMatchObject({
    code: "CONFLICT",
  });
  expect(startWorkflow).not.toHaveBeenCalled();
  expect(
    Number(
      (
        await testDb.execute(
          "select count(*) as n from project_competitor_research_runs",
        )
      )[0]?.n,
    ),
  ).toBe(0);
});
