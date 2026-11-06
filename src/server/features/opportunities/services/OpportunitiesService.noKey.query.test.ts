import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const { testDb, r2, getPerformance } = await vi.hoisted(async () => {
  const { createSiteAuthorityTestDb } =
    await import("../../site-authority/siteAuthorityTestDb");
  return {
    testDb: await createSiteAuthorityTestDb(),
    r2: new Map<string, string>(),
    getPerformance: vi.fn(),
  };
});
vi.mock("cloudflare:workers", () => ({
  env: {
    DATABASE_PROVIDER: testDb.provider,
    R2: {
      get: async (key: string) => {
        const body = r2.get(key);
        return body ? { customMetadata: {}, text: async () => body } : null;
      },
      put: async (key: string, body: string) => void r2.set(key, body),
    },
  },
}));
vi.mock("@/db", () => ({ db: testDb.db }));
vi.mock("@/db/runBatch", () => ({ runBatch: testDb.runBatch }));
vi.mock("@/server/lib/runtime-env", () => ({
  usesBetterAuthServer: async () => true,
}));
vi.mock("@/server/lib/provider-access", () => ({
  hasDataforseoAccess: async () => false,
}));
// Search Console is mocked: this checks what the page does with its data.
vi.mock(
  "@/server/features/gsc/services/GscService",
  async (importOriginal) => ({
    ...(await importOriginal<object>()),
    GscService: { getPerformance },
  }),
);

import { DashboardSiteService } from "@/server/features/dashboard/services/DashboardSiteService";
import { OpportunitiesService } from "./OpportunitiesService";
import {
  connectSearchConsole,
  opportunityTestProjectId as projectId,
  seedAuditWith,
} from "./opportunitiesTestSeeds";

const networkCall = vi.fn();
const list = () =>
  OpportunitiesService.list({ projectId, organizationId: "organization" });

beforeEach(async () => {
  r2.clear();
  getPerformance.mockReset();
  networkCall.mockReset();
  vi.stubGlobal("fetch", networkCall);
  await testDb.seedProject();
  await testDb.execute(
    `update projects set id='${projectId}' where id='project'`,
  );
});
afterAll(testDb.close);

describe("Opportunities with no DataForSEO key", () => {
  it("doesn't list AI visibility as a setup step", async () => {
    const { opportunities, setup, sources } = await list();

    expect(opportunities).toEqual([]);
    expect(setup.map((item) => item.id)).toEqual([
      "setup:site-audit",
      "setup:search-console",
      "setup:competitors",
    ]);
    expect(
      setup.find((item) => item.id === "setup:competitors")?.nextStep,
    ).toBe("Add them yourself on the Context page.");
    expect(
      sources.find((source) => source.id === "ai_visibility"),
    ).toMatchObject({
      state: "not_checked",
      detail: "Optional: needs a DataForSEO key.",
    });
  });

  it("builds its list from the audit and Search Console, with no error and no paid call", async () => {
    await seedAuditWith(testDb.execute)({
      id: "audit",
      startedAt: "2026-11-01T00:00:00.000Z",
      issues: [{ type: "missing-title", severity: "critical", pages: 3 }],
    });
    await connectSearchConsole();
    getPerformance.mockResolvedValueOnce({
      rows: [{ keys: ["near"], clicks: 4, impressions: 500, position: 8 }],
    });
    await DashboardSiteService.getKeywords(projectId, "organization");

    const { opportunities, sources } = await list();

    expect(opportunities.map((item) => item.id)).toEqual([
      "audit:missing-title",
      "search-console:striking-distance",
    ]);
    expect(sources.map((source) => source.state)).toEqual([
      "checked",
      "checked",
      "not_checked",
      "needs_setup",
    ]);
    expect(networkCall).not.toHaveBeenCalled();
  });
});
