import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const { testDb, startWorkflow, modelAccess, modelSettings, workflow } =
  await vi.hoisted(async () => {
    const { createCompetitorResearchTestDb } =
      await import("./competitorResearchTestDb");
    return {
      testDb: await createCompetitorResearchTestDb(),
      startWorkflow: vi.fn(async (..._args: unknown[]) => undefined),
      modelAccess: vi.fn<() => { apiKey: string } | null>(() => ({
        apiKey: "test",
      })),
      modelSettings: {
        defaultId: "model-a",
        override: undefined as string | undefined,
      },
      workflow: {
        get: vi.fn(
          async (): Promise<{ status: () => Promise<{ status: string }> }> => {
            throw new Error("missing");
          },
        ),
      },
    };
  });
vi.mock("cloudflare:workers", () => ({
  env: { DATABASE_PROVIDER: testDb.provider, AI_VISIBILITY_WORKFLOW: workflow },
}));
vi.mock("@/db", () => ({ db: testDb.db }));
vi.mock("@/db/runBatch", () => ({ runBatch: testDb.runBatch }));
vi.mock("@/server/lib/runtime-env", () => ({
  usesBetterAuthServer: async () => true,
  isHostedServerAuthMode: async () => false,
  getOptionalEnvValue: async () => modelSettings.override,
  getWorkersEnv: async () => ({}),
}));
vi.mock("@/server/lib/provider-access", () => ({
  hasDataforseoAccess: async () => true,
}));
vi.mock("@/server/lib/openrouter", () => ({
  getOpenRouterAccess: modelAccess,
  buildChatAgentModel: (_access: { apiKey: string }, modelId?: string) => ({
    modelId: modelId ?? modelSettings.defaultId,
  }),
}));
vi.mock("@/server/lib/startWorkflow", () => ({ startWorkflow }));

import { CompetitorResearchService as service } from "./CompetitorResearchService";
import { CompetitorResearchRepository as repository } from "../repositories/CompetitorResearchRepository";
import { competitorExecutionConfiguration } from "./competitorResearchAccess";
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
beforeEach(async () => {
  await seedCompetitorProject(testDb);
  modelAccess.mockReturnValue({ apiKey: "test" });
  modelSettings.defaultId = "model-a";
  modelSettings.override = undefined;
  workflow.get.mockImplementation(async () => {
    throw new Error("missing");
  });
});
afterAll(testDb.close);

describe("CompetitorResearchService migrated SQLite", () => {
  it("keeps restored history readable but denies its old request ID and review authority", async () => {
    const state = await service.get(actor, projectId);
    const input = {
      projectId,
      requestId: crypto.randomUUID(),
      expectedContextVersion: state.contextVersion,
      contextHash: state.contextHash,
      capabilityFingerprint: state.capabilityFingerprint,
      confirmedPaidWork: true as const,
    };
    const started = await service.start(actor, input);
    expect(started.ok).toBe(true);
    if (!started.ok) return;
    await testDb.execute(
      `update project_competitor_research_runs set state='finished',outcome='complete',reason='restored',active_project_id=null,finished_at_ms=1000,sponsor_user_id=null,sponsor_member_id=null,sponsor_role=null where id='${started.run.id}'`,
    );
    expect(await service.start(actor, input)).toMatchObject({
      ok: false,
      code: "conflict",
    });
    expect(startWorkflow).toHaveBeenCalledTimes(1);
    expect(
      await service.getRun(actor, { projectId, runId: started.run.id }),
    ).toMatchObject({
      state: "available",
      run: { canAccept: false },
    });
  });

  it("reports readiness and reads without creating work", async () => {
    const state = await service.get(actor, projectId);
    expect(state.ready).toBe(true);
    expect(state.recentRuns).toEqual([]);
    expect(startWorkflow).not.toHaveBeenCalled();
    expect(
      await testDb.execute("select id from project_competitor_research_runs"),
    ).toHaveLength(0);
  });

  it("returns a blocked receipt without launching when model access is absent", async () => {
    modelAccess.mockReturnValueOnce(null);
    const state = await service.get(actor, projectId);
    modelAccess.mockReturnValueOnce(null);
    const result = await service.start(actor, {
      projectId,
      requestId: crypto.randomUUID(),
      expectedContextVersion: state.contextVersion,
      contextHash: state.contextHash,
      capabilityFingerprint: state.capabilityFingerprint,
      confirmedPaidWork: true,
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.run.outcome).toBe("blocked");
    expect(startWorkflow).not.toHaveBeenCalled();
  });

  it("persists a stable request receipt and only one workflow ID", async () => {
    const state = await service.get(actor, projectId);
    const input = {
      projectId,
      requestId: crypto.randomUUID(),
      expectedContextVersion: state.contextVersion,
      contextHash: state.contextHash,
      capabilityFingerprint: state.capabilityFingerprint,
      confirmedPaidWork: true as const,
    };
    const first = await service.start(actor, input);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(JSON.stringify(first)).not.toMatch(
      /admissionToken|requestHash|issueToken|billingToken|authority@example.com/,
    );
    workflow.get.mockImplementationOnce(async () => ({
      status: async () => ({ status: "running" }),
    }));
    const second = await service.start(actor, input);
    expect(second.ok && second.replayed).toBe(true);
    expect(startWorkflow).toHaveBeenCalledTimes(1);
    expect(startWorkflow.mock.calls[0]?.[1]).toMatchObject({
      id: `competitor-research-${first.run.id}`,
      params: { competitorResearchRunId: first.run.id },
    });
    expect(
      await testDb.execute("select id from project_competitor_research_runs"),
    ).toHaveLength(1);
    const changed = await service.start(actor, {
      ...input,
      capabilityFingerprint: "f".repeat(64),
    });
    expect(changed).toMatchObject({ ok: false, code: "conflict" });
  });

  it("blocks issuance when the resolved default primary model drifts", async () => {
    const state = await service.get(actor, projectId);
    const started = await service.start(actor, {
      projectId,
      requestId: crypto.randomUUID(),
      expectedContextVersion: state.contextVersion,
      contextHash: state.contextHash,
      capabilityFingerprint: state.capabilityFingerprint,
      confirmedPaidWork: true,
    });
    expect(started.ok).toBe(true);
    if (!started.ok) return;
    const id = started.run.id;
    expect(
      await repository.prepareOperation(
        id,
        "search_0",
        {
          inputHash: "d".repeat(64),
          queryText: "Project alternatives",
          targetUrl: null,
        },
        Date.now(),
      ),
    ).toEqual({ kind: "prepared" });
    modelSettings.defaultId = "model-b";
    const changed = await competitorExecutionConfiguration();
    expect(changed.modelConfigurationHash).not.toBe(
      (
        await repository.getRun(
          (await repository.getSnapshot(actor, projectId)).scope,
          projectId,
          id,
        )
      ).run.modelConfigurationHash,
    );
    expect(
      await repository.issueOperation(
        id,
        "search_0",
        Date.now(),
        changed.modelConfigurationHash,
      ),
    ).toEqual({ kind: "blocked" });
    expect(
      await testDb.execute(
        `select state from project_competitor_research_operations where run_id='${id}' and slot='search_0'`,
      ),
    ).toEqual([expect.objectContaining({ state: "prepared" })]);
  });

  it("uses the configured explicit model even if the default changes", async () => {
    modelSettings.override = "configured-model";
    const first = await competitorExecutionConfiguration();
    modelSettings.defaultId = "model-b";
    expect(
      (await competitorExecutionConfiguration()).modelConfigurationHash,
    ).toBe(first.modelConfigurationHash);
  });

  it("rejects stale context and removed members before admission", async () => {
    const state = await service.get(actor, projectId);
    const input = {
      projectId,
      requestId: crypto.randomUUID(),
      expectedContextVersion: state.contextVersion,
      contextHash: state.contextHash,
      capabilityFingerprint: state.capabilityFingerprint,
      confirmedPaidWork: true as const,
    };
    expect(
      await service.start(actor, { ...input, contextHash: "f".repeat(64) }),
    ).toMatchObject({ ok: false, code: "context_changed" });
    await testDb.execute("delete from member where id='membership'");
    await expect(service.start(actor, input)).rejects.toThrow();
    expect(
      await testDb.execute("select id from project_competitor_research_runs"),
    ).toHaveLength(0);
  });

  it("returns an erased wrapper and never relaunches a redacted request", async () => {
    const state = await service.get(actor, projectId);
    const input = {
      projectId,
      requestId: crypto.randomUUID(),
      expectedContextVersion: state.contextVersion,
      contextHash: state.contextHash,
      capabilityFingerprint: state.capabilityFingerprint,
      confirmedPaidWork: true as const,
    };
    const first = await service.start(actor, input);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    await testDb.execute(
      `update project_competitor_research_runs set redacted_at_ms=1 where id='${first.run.id}'`,
    );
    expect(
      await service.getRun(actor, { projectId, runId: first.run.id }),
    ).toEqual({
      state: "unavailable",
      runId: first.run.id,
      reason: "privacy_erased",
    });
    expect(await service.start(actor, input)).toMatchObject({
      ok: false,
      code: "privacy_erased",
    });
    expect(startWorkflow).toHaveBeenCalledTimes(1);
  });

  it("reconciles a terminal engine status without recreating the fixed ID", async () => {
    const state = await service.get(actor, projectId);
    const input = {
      projectId,
      requestId: crypto.randomUUID(),
      expectedContextVersion: state.contextVersion,
      contextHash: state.contextHash,
      capabilityFingerprint: state.capabilityFingerprint,
      confirmedPaidWork: true as const,
    };
    const first = await service.start(actor, input);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    await testDb.execute(
      `update project_competitor_research_operations set state='succeeded',input_hash='${"a".repeat(64)}',issue_token='${crypto.randomUUID()}',issued_at_ms=1,finished_at_ms=2,cost_usd=0.01,usage_basis='usd',provider='dataforseo' where run_id='${first.run.id}' and slot='search_0'`,
    );
    workflow.get.mockImplementation(async () => ({
      status: async () => ({ status: "complete" }),
    }));
    const replay = await service.start(actor, input);
    expect(replay.ok).toBe(true);
    if (replay.ok) {
      expect(replay.run.outcome).toBe("unknown");
      expect(replay.run.billingState).toBe("unknown");
      expect(replay.run.knownCostUsd).toBe(0.01);
    }
    expect(startWorkflow).toHaveBeenCalledTimes(1);
  });
});
