import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
const { testDb } = await vi.hoisted(async () => {
  const { createSiteAuthorityTestDb } =
    await import("../../site-authority/siteAuthorityTestDb");
  return { testDb: await createSiteAuthorityTestDb() };
});
vi.mock("cloudflare:workers", () => ({
  env: { DATABASE_PROVIDER: testDb.provider },
}));
vi.mock("@/db", () => ({ db: testDb.db }));
vi.mock("@/db/runBatch", () => ({ runBatch: testDb.runBatch }));
vi.mock("@/server/lib/runtime-env", () => ({
  usesBetterAuthServer: () => Promise.resolve(true),
}));
import { CompetitorResearchRepository as repository } from "./CompetitorResearchRepository";
import { sha256Hex } from "@/server/lib/audit/ids";
const repo = repository;

beforeEach(testDb.seedProject);
afterAll(testDb.close);
const actor = {
  userId: "user",
  userEmail: "authority@example.com",
  organizationId: "organization",
  role: "owner",
  surface: "web" as const,
};

async function setup() {
  const projectId = crypto.randomUUID(),
    runId = crypto.randomUUID(),
    candidateId = crypto.randomUUID();
  await testDb.execute(
    `insert into projects (id,organization_id,name,domain) values ('${projectId}','organization','Business','example.com')`,
  );
  const { scope, snapshot } = await repo.getSnapshot(actor, projectId);
  const admission = {
    projectId,
    id: runId,
    requestId: crypto.randomUUID(),
    requestHash: "a".repeat(64),
    snapshot,
    businessSummary: "Business",
    modelBackendId: null,
    modelConfigurationHash: "b".repeat(64),
    deadlineAtMs: 100000,
    nowMs: 1000,
  };
  expect((await repo.admitSetup(scope, admission)).kind).toBe("created");
  const text = "Evidence for a competitor business";
  const candidate = {
    id: candidateId,
    domain: "rival.com",
    name: "Rival",
    notes: "Similar services",
    source: {
      url: "https://rival.com/",
      excerpt: text,
      textHash: await sha256Hex(text),
      capturedAtMs: 1100,
    },
    extractionMethod: "legacy_read_site" as const,
    partialEvidence: false,
  };
  expect(
    await repo.recordSetupEvidence(scope, {
      runId,
      snapshot,
      candidates: [candidate],
      outcome: "complete",
      nowMs: 1200,
    }),
  ).toEqual({ kind: "stored" });
  const input = {
    projectId,
    runId,
    mutationId: crypto.randomUUID(),
    expectedContextVersion: snapshot.contextVersion,
    selections: [{ candidateId, name: "Rival", notes: "Reviewed" }],
  };
  return { scope, admission, candidate, input };
}

describe("research review and evidence receipts", () => {
  it("replays historical review without recreating a deleted competitor", async () => {
    const { scope, input } = await setup();
    const first = await repo.accept(scope, input, "c".repeat(64), 1300);
    expect(first).toMatchObject({
      ok: true,
      replayed: false,
      rows: [
        { candidateId: input.selections[0].candidateId, outcome: "added" },
      ],
    });
    await testDb.execute(
      `delete from project_competitors where project_id='${input.projectId}'`,
    );
    const replay = await repo.accept(scope, input, "c".repeat(64), 1400);
    expect(replay).toMatchObject({
      ok: true,
      replayed: true,
      rows: [{ outcome: "added" }],
    });
    expect(
      await testDb.execute(
        `select id from project_competitors where project_id='${input.projectId}'`,
      ),
    ).toHaveLength(0);
  });
  it.each([4, 5, 6, 7, 8])(
    "rolls back review after batch boundary %i",
    async (index) => {
      const { scope, input } = await setup();
      const p = input.projectId;
      const runId = input.runId;
      const q = testDb.execute;
      testDb.failNextBatchAt(index);
      await expect(
        repo.accept(scope, input, "c".repeat(64), 1300),
      ).rejects.toThrow();
      expect(
        await q(`select id from project_competitors where project_id='${p}'`),
      ).toHaveLength(0);
      const [run] = await q(
        `select review_mutation_id from project_competitor_research_runs where id='${runId}'`,
      );
      expect(run?.review_mutation_id).toBeNull();
      expect(
        await q(
          `select project_id from content_project_state where project_id='${p}'`,
        ),
      ).toHaveLength(0);
    },
  );
  it("serializes identical concurrent acceptance without overwriting provenance", async () => {
    const { scope, input } = await setup();
    const results = await Promise.all([
      repo.accept(scope, input, "c".repeat(64), 1300),
      repo.accept(scope, input, "c".repeat(64), 1300),
    ]);
    expect(results.every((r) => r.ok)).toBe(true);
    expect(new Set(results.flatMap((r) => (r.ok ? [r.replayed] : [])))).toEqual(
      new Set([true, false]),
    );
    const rows = await testDb.execute(
      `select id,domain,name,notes from project_competitors where project_id='${input.projectId}'`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      domain: "rival.com",
      name: "Rival",
      notes: "Reviewed",
    });
    const [candidate] = await testDb.execute(
      `select acceptance_outcome,canonical_competitor_id from project_competitor_research_candidates where run_id='${input.runId}'`,
    );
    expect(candidate).toMatchObject({
      acceptance_outcome: "added",
      canonical_competitor_id: String(rows[0]?.id),
    });
    const [version] = await testDb.execute(
      `select context_version from content_project_state where project_id='${input.projectId}'`,
    );
    expect(Number(version?.context_version)).toBe(1);
  });
  it("rejects a stale context without adding a competitor", async () => {
    const { scope, input } = await setup();
    await testDb.execute(
      `insert into content_project_state (project_id,context_version,updated_at_ms) values ('${input.projectId}',1,1250)`,
    );
    expect(await repo.accept(scope, input, "c".repeat(64), 1300)).toMatchObject(
      { ok: false, code: "context_changed" },
    );
    expect(
      await testDb.execute(
        `select id from project_competitors where project_id='${input.projectId}'`,
      ),
    ).toHaveLength(0);
  });
  it("refuses erased request replay before comparing either submitted hash", async () => {
    const { scope, admission } = await setup();
    await testDb.execute(
      `update project_competitor_research_runs set redacted_at_ms=1300,request_hash='',sponsor_user_id=null,sponsor_member_id=null,sponsor_role=null where id='${admission.id}'`,
    );
    const before = await testDb.execute(
      "select id from project_competitor_research_operations",
    );
    for (const requestHash of [admission.requestHash, "f".repeat(64)]) {
      expect(
        await repo.admitSetup(scope, {
          ...admission,
          id: crypto.randomUUID(),
          requestHash,
        }),
      ).toEqual({ kind: "privacy_erased", runId: admission.id });
    }
    expect(
      await testDb.execute("select id from project_competitor_research_runs"),
    ).toHaveLength(1);
    expect(
      await testDb.execute(
        "select id from project_competitor_research_operations",
      ),
    ).toHaveLength(before.length);
    expect(
      await testDb.execute("select id from project_competitors"),
    ).toHaveLength(0);
    await expect(
      repo.admitSetup(
        { ...scope, actor: { ...scope.actor, organizationId: "foreign" } },
        admission,
      ),
    ).rejects.toThrow();
  });
  it("resolves the current sponsor after terminalization for billing", async () => {
    const { admission } = await setup();
    const authority = await repo.getAuthority(admission.id);
    expect(authority?.scope.actor).toMatchObject({
      userId: "user",
      userEmail: "authority@example.com",
      organizationId: "organization",
      role: "owner",
    });
  });
});
