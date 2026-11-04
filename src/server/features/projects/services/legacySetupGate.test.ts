import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const { testDb, workflow, mode } = await vi.hoisted(async () => {
  const { createSiteAuthorityTestDb } =
    await import("@/server/features/site-authority/siteAuthorityTestDb");
  return {
    testDb: await createSiteAuthorityTestDb(),
    workflow: {
      get: vi.fn(
        async (
          _id: string,
        ): Promise<{
          status: () => Promise<{ status: string; output?: unknown }>;
        }> => {
          throw new Error("missing or backend unavailable");
        },
      ),
    },
    mode: { betterAuth: true },
  };
});
vi.mock("cloudflare:workers", () => ({
  env: { DATABASE_PROVIDER: testDb.provider, AI_VISIBILITY_WORKFLOW: workflow },
}));
vi.mock("@/db", () => ({ db: testDb.db }));
vi.mock("@/db/runBatch", () => ({ runBatch: testDb.runBatch }));
vi.mock("@/server/lib/runtime-env", () => ({
  usesBetterAuthServer: async () => mode.betterAuth,
}));

import { CompetitorResearchRepository } from "@/server/features/competitor-research/repositories/CompetitorResearchRepository";
import {
  assertLegacySetupLaunchAllowed,
  inspectLegacySetupBeforePaidStart,
} from "./legacySetupGate";

const actor = {
  userId: "user",
  userEmail: "authority@example.com",
  organizationId: "organization",
  role: "owner",
  surface: "web" as const,
};
const review = {
  name: "Example",
  domain: "example.com",
  overview: "Example business",
  competitors: [],
  preserveCompetitors: false,
  suggestedTopics: [],
};
const scope = async () =>
  (await CompetitorResearchRepository.getSnapshot(actor, "project")).scope;

beforeEach(async () => {
  mode.betterAuth = true;
  await testDb.seedProject();
  workflow.get.mockImplementation(async () => {
    throw new Error("missing or backend unavailable");
  });
});
afterAll(testDb.close);

describe("legacy setup gate on migrated projects", () => {
  it("uses creation proof without a Workflow lookup and refuses legacy launch", async () => {
    await testDb.execute(
      "update projects set legacy_setup_absence_proven=1 where id='project'",
    );
    expect(
      await inspectLegacySetupBeforePaidStart(await scope(), "project"),
    ).toEqual({
      kind: "clear",
    });
    expect(workflow.get).not.toHaveBeenCalled();
    await expect(
      assertLegacySetupLaunchAllowed("project", "organization"),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("treats missing/get and status failures as unavailable", async () => {
    expect(
      await inspectLegacySetupBeforePaidStart(await scope(), "project"),
    ).toEqual({
      kind: "unavailable",
    });
    workflow.get.mockResolvedValue({
      status: async () => {
        throw new Error("backend unavailable");
      },
    });
    expect(
      await inspectLegacySetupBeforePaidStart(await scope(), "project"),
    ).toEqual({
      kind: "unavailable",
    });
  });

  it("preserves running and valid review while clearing only known terminal status", async () => {
    const current = await scope();
    workflow.get.mockResolvedValue({
      status: async () => ({ status: "waiting" }),
    });
    expect(await inspectLegacySetupBeforePaidStart(current, "project")).toEqual(
      {
        kind: "running",
      },
    );
    workflow.get.mockResolvedValue({
      status: async () => ({ status: "complete", output: { review } }),
    });
    expect(await inspectLegacySetupBeforePaidStart(current, "project")).toEqual(
      {
        kind: "review",
        review: { ...review, suggestedKeywords: [] },
      },
    );
    workflow.get.mockResolvedValue({
      status: async () => ({ status: "errored" }),
    });
    expect(await inspectLegacySetupBeforePaidStart(current, "project")).toEqual(
      {
        kind: "clear",
      },
    );
    workflow.get.mockResolvedValue({
      status: async () => ({ status: "unknown" }),
    });
    expect(await inspectLegacySetupBeforePaidStart(current, "project")).toEqual(
      {
        kind: "unavailable",
      },
    );
    expect(
      (
        await testDb.execute(
          "select legacy_setup_absence_proven from projects where id='project'",
        )
      )[0]?.legacy_setup_absence_proven,
    ).toBe(0);
  });

  it("clears a completed run only on an explicit null review", async () => {
    const current = await scope();
    workflow.get.mockResolvedValue({
      status: async () => ({ status: "complete", output: { review: null } }),
    });
    expect(await inspectLegacySetupBeforePaidStart(current, "project")).toEqual(
      { kind: "clear" },
    );
    for (const output of [
      undefined,
      {},
      { review: { ...review, competitors: "corrupt" } },
    ]) {
      workflow.get.mockResolvedValue({
        status: async () => ({ status: "complete", output }),
      });
      expect(
        await inspectLegacySetupBeforePaidStart(current, "project"),
      ).toEqual({ kind: "unavailable" });
    }
  });

  it("rechecks tenant, membership, role and archive before trusting proof", async () => {
    const current = await scope();
    await expect(
      inspectLegacySetupBeforePaidStart(current, "foreign-project"),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await testDb.execute(
      "update member set role='viewer' where id='membership'",
    );
    await expect(
      inspectLegacySetupBeforePaidStart(current, "project"),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await testDb.execute(
      "update member set role='owner' where id='membership'",
    );
    await testDb.execute("delete from member where id='membership'");
    await expect(
      inspectLegacySetupBeforePaidStart(current, "project"),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await testDb.execute(
      "update projects set archived_at='2026-11-03' where id='project'",
    );
    await expect(
      inspectLegacySetupBeforePaidStart(current, "project"),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("keeps unmarked delegated legacy setup available without local membership", async () => {
    mode.betterAuth = false;
    const delegated = await scope();
    expect(delegated.requireMembership).toBe(false);
    expect(delegated.memberId).toBeNull();
    await expect(
      assertLegacySetupLaunchAllowed("project", "organization"),
    ).resolves.toBeUndefined();
    expect(
      await inspectLegacySetupBeforePaidStart(delegated, "project"),
    ).toEqual({
      kind: "unavailable",
    });
  });
});
