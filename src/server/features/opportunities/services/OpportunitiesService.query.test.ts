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
// Search Console is the only external boundary near this feature.
vi.mock(
  "@/server/features/gsc/services/GscService",
  async (importOriginal) => ({
    ...(await importOriginal<object>()),
    GscService: { getPerformance },
  }),
);

import { AuditRepository } from "@/server/features/audit/repositories/AuditRepository";
import { CompetitorResearchRepository } from "@/server/features/competitor-research/repositories/CompetitorResearchRepository";
import { DashboardSiteService } from "@/server/features/dashboard/services/DashboardSiteService";
import { OpportunitiesService } from "./OpportunitiesService";
import {
  connectSearchConsole,
  opportunityTestProjectId as projectId,
  seedAiRun,
  seedAuditWith,
  seedResearchRun,
} from "./opportunitiesTestSeeds";

const input = { projectId, organizationId: "organization" };
const networkCall = vi.fn();

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

const seedAudit = seedAuditWith(testDb.execute);
const list = () => OpportunitiesService.list(input);
const sourceState = async (id: string) =>
  (await list()).sources.find((source) => source.id === id);

describe("OpportunitiesService", () => {
  it("reports an empty project as not checked, never as zero problems", async () => {
    const result = await list();
    expect(result.opportunities).toEqual([]);
    expect(result.sources.map((source) => source.state)).toEqual([
      "not_checked",
      "needs_setup",
      "needs_setup",
      "needs_setup",
    ]);
    expect(result.setup.map((item) => item.id)).toEqual([
      "setup:site-audit",
      "setup:search-console",
      "setup:ai-visibility",
      "setup:competitors",
    ]);
  });

  it("keeps setup nudges out of the measured list and without a severity", async () => {
    const result = await list();
    for (const nudge of result.setup) {
      expect(nudge).toMatchObject({
        type: "setup",
        severity: null,
        affected: null,
        status: "needs_setup",
      });
    }
    await seedAudit({
      id: "audit",
      startedAt: "2026-11-01T00:00:00.000Z",
      issues: [{ type: "missing-title", severity: "critical", pages: 1 }],
    });
    const after = await list();
    expect(after.opportunities.every((item) => item.type !== "setup")).toBe(
      true,
    );
    expect(after.setup.map((item) => item.id)).not.toContain(
      "setup:site-audit",
    );
  });

  it("groups one audit issue across 40 pages into a single item with exact evidence", async () => {
    await seedAudit({
      id: "audit",
      startedAt: "2026-11-01T00:00:00.000Z",
      issues: [{ type: "duplicate-title", severity: "warning", pages: 40 }],
    });
    const { opportunities, sources } = await list();
    expect(opportunities).toHaveLength(1);
    expect(opportunities[0]).toMatchObject({
      id: "audit:duplicate-title",
      type: "technical",
      title: "Duplicate title",
      severity: "medium",
      affected: { count: 40, unit: "page" },
      effort: "medium",
      status: "open",
      evidence: {
        source: "Site audit",
        summary: "40 of 120 crawled pages.",
        observedAt: "2026-11-01T00:00:00.000Z",
        moreCount: 35,
        link: { target: { page: "audit", auditId: "audit" } },
      },
    });
    expect(opportunities[0].evidence.items[0]).toEqual({
      label: "https://example.com/000",
      url: "https://example.com/000",
    });
    expect(opportunities[0].evidence.items).toHaveLength(5);
    expect(sources[0].state).toBe("checked");
  });

  it("ranks by severity, then pages affected, then title", async () => {
    await seedAudit({
      id: "audit",
      startedAt: "2026-11-01T00:00:00.000Z",
      issues: [
        { type: "title-too-long", severity: "info", pages: 30 },
        { type: "missing-h1", severity: "warning", pages: 2 },
        { type: "duplicate-title", severity: "warning", pages: 9 },
        { type: "missing-title", severity: "critical", pages: 1 },
        { type: "multiple-h1", severity: "warning", pages: 2 },
      ],
    });
    expect((await list()).opportunities.map((item) => item.id)).toEqual([
      "audit:missing-title",
      "audit:duplicate-title",
      "audit:missing-h1",
      "audit:multiple-h1",
      "audit:title-too-long",
    ]);
  });

  it("reads the latest completed audit, skipping newer running or failed ones", async () => {
    await seedAudit({
      id: "older",
      startedAt: "2026-10-01T00:00:00.000Z",
      issues: [{ type: "missing-h1", severity: "warning", pages: 1 }],
    });
    await seedAudit({
      id: "latest",
      startedAt: "2026-11-01T00:00:00.000Z",
      issues: [{ type: "missing-title", severity: "critical", pages: 1 }],
    });
    await seedAudit({
      id: "running",
      status: "running",
      startedAt: "2026-11-02T00:00:00.000Z",
      issues: [{ type: "thin-content", severity: "warning", pages: 1 }],
    });
    expect((await list()).opportunities.map((item) => item.id)).toEqual([
      "audit:missing-title",
    ]);
  });

  it("doesn't ask for a first audit while one is running", async () => {
    await seedAudit({
      id: "running",
      status: "running",
      startedAt: "2026-11-02T00:00:00.000Z",
    });
    const { setup, sources } = await list();
    expect(sources[0].state).toBe("not_checked");
    expect(setup.map((item) => item.id)).not.toContain("setup:site-audit");
  });

  it("does not treat an audit that read no pages as a clean result", async () => {
    await seedAudit({
      id: "audit",
      startedAt: "2026-11-01T00:00:00.000Z",
      pagesCrawled: 0,
    });
    expect(await sourceState("site_audit")).toMatchObject({
      state: "not_checked",
    });
  });

  it("says when a clean audit could not read every page", async () => {
    await seedAudit({
      id: "audit",
      startedAt: "2026-11-01T00:00:00.000Z",
      issues: [{ type: "blocked-page", severity: "critical", pages: 3 }],
    });
    expect((await sourceState("site_audit"))?.detail).toContain(
      "Some pages could not be read",
    );
  });

  it("never shows evidence saved for another project", async () => {
    await seedAudit({
      id: "foreign-audit",
      project: "foreign-project",
      startedAt: "2026-11-01T00:00:00.000Z",
      issues: [{ type: "missing-title", severity: "critical", pages: 3 }],
    });
    await seedAiRun([{ rivalCited: true }], "foreign-project");
    await connectSearchConsole("foreign-project", "foreign");
    await testDb.execute(
      `insert into project_competitors (id,project_id,domain,updated_by) values ('foreign-rival','foreign-project','rival.com','user')`,
    );
    const result = await list();
    expect(result.opportunities).toEqual([]);
    expect(result.sources.every((source) => source.state !== "checked")).toBe(
      true,
    );
  });

  it("shows connected Search Console with nothing saved as not checked, without calling Google", async () => {
    await connectSearchConsole();
    const result = await list();
    expect(result.sources[1].state).toBe("not_checked");
    expect(result.opportunities).toEqual([]);
    expect(result.setup.map((item) => item.id)).not.toContain(
      "setup:search-console",
    );
    expect(getPerformance).not.toHaveBeenCalled();
    expect(networkCall).not.toHaveBeenCalled();
  });

  it("groups saved striking-distance queries into one item, without calling Google again", async () => {
    await connectSearchConsole();
    getPerformance.mockResolvedValueOnce({
      rows: [
        { keys: ["top query"], clicks: 90, impressions: 900, position: 2 },
        { keys: ["near"], clicks: 4, impressions: 500, position: 8.26 },
        { keys: ["nearer"], clicks: 9, impressions: 700, position: 5 },
        { keys: ["far"], clicks: 0, impressions: 300, position: 21 },
      ],
    });
    await DashboardSiteService.getKeywords(projectId, "organization");
    getPerformance.mockClear();

    const { opportunities, sources } = await list();
    expect(sources[1].state).toBe("checked");
    expect(opportunities).toHaveLength(1);
    expect(opportunities[0]).toMatchObject({
      type: "content",
      affected: { count: 2, unit: "query" },
      evidence: {
        source: "Search Console",
        items: [
          {
            label: "nearer",
            detail: "Position 5.0, 700 impressions, 9 clicks",
          },
          {
            label: "near",
            detail: "Position 8.3, 500 impressions, 4 clicks",
          },
        ],
      },
    });
    expect(getPerformance).not.toHaveBeenCalled();
    expect(networkCall).not.toHaveBeenCalled();
  });

  it("separates competitor gaps from plain absence and counts only collected answers", async () => {
    await seedAiRun([
      { rivalCited: true },
      { rivalCited: true },
      {},
      { ownNamed: true, rivalCited: true },
      { markdown: null },
      { failed: true },
      { branded: true },
    ]);
    const { opportunities, sources } = await list();
    expect(sources[2]).toMatchObject({
      state: "checked",
      detail: "4 of 6 answers collected across 4 prompts.",
    });
    expect(opportunities.map((item) => item.id)).toEqual([
      "ai-visibility:competitor-gap",
      "ai-visibility:brand-absent",
    ]);
    expect(opportunities[0]).toMatchObject({
      severity: "medium",
      affected: { count: 2, unit: "prompt" },
      evidence: { summary: "2 of 4 answered prompts. Rival in 2 prompts." },
    });
    expect(opportunities[0].evidence.items[0]).toMatchObject({
      label: "Question 0?",
      detail: "Named or cited instead: Rival",
      target: { page: "ai_prompt", promptId: `${projectId}-prompt-0` },
    });
    expect(opportunities[1]).toMatchObject({
      severity: "low",
      affected: { count: 1, unit: "prompt" },
    });
  });

  it("does not read a run with no collected answers as brand absence", async () => {
    await seedAiRun([{ failed: true }, { markdown: null }]);
    const { opportunities, sources } = await list();
    expect(sources[2].state).toBe("not_checked");
    expect(opportunities).toEqual([]);
  });

  it("nudges to review verified competitors research found, until the run is reviewed", async () => {
    const { scope, snapshot, runId, candidateId } = await seedResearchRun();
    const before = (await list()).setup.find(
      (item) => item.id === "setup:competitor-review",
    );
    expect(before).toMatchObject({
      severity: null,
      evidence: {
        source: "Competitor research",
        summary: "1 competitor not saved yet.",
        items: [
          {
            label: "Rival",
            detail: "rival.com",
            url: "https://rival.com/about",
          },
        ],
      },
    });
    await CompetitorResearchRepository.accept(
      scope,
      {
        projectId,
        runId,
        mutationId: crypto.randomUUID(),
        expectedContextVersion: snapshot.contextVersion,
        selections: [{ candidateId, name: "Rival", notes: "Reviewed" }],
      },
      "c".repeat(64),
      1200,
    );
    const after = await list();
    expect(after.setup.map((item) => item.id)).not.toContain(
      "setup:competitor-review",
    );
    expect(after.sources[3]).toMatchObject({
      state: "checked",
      detail: "1 competitor saved.",
    });
  });

  it("doesn't nudge about a found competitor that is already saved", async () => {
    await seedResearchRun();
    await testDb.execute(
      `insert into project_competitors (id,project_id,domain,updated_by) values ('saved','${projectId}','rival.com','user')`,
    );
    expect((await list()).setup.map((item) => item.id)).not.toContain(
      "setup:competitor-review",
    );
  });

  it("marks a source it can't read as unavailable and keeps the rest", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    vi.spyOn(AuditRepository, "getAuditsByProject").mockRejectedValueOnce(
      new Error("database unavailable"),
    );
    await seedAiRun([{ rivalCited: true }]);
    const { sources, opportunities } = await list();
    expect(sources[0]).toMatchObject({
      id: "site_audit",
      state: "unavailable",
    });
    expect(opportunities.map((item) => item.type)).toEqual(["ai_visibility"]);
    expect(consoleError).toHaveBeenCalledOnce();
    consoleError.mockRestore();
  });
});
