import { afterAll, beforeEach, expect, it, vi } from "vitest";

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

import { CompetitorResearchRepository as repo } from "./CompetitorResearchRepository";
import { WebsiteResearchAttemptRepository as attempts } from "@/server/features/projects/repositories/WebsiteResearchAttemptRepository";
import { sha256Hex } from "@/server/lib/audit/ids";

beforeEach(testDb.seedProject);
afterAll(testDb.close);

it("redacts a departed sponsor's run and attempt while preserving an edited canonical row", async () => {
  const actor = {
    userId: "user",
    userEmail: "authority@example.com",
    organizationId: "organization",
    role: "owner",
    surface: "web" as const,
  };
  const { scope, snapshot } = await repo.getSnapshot(actor, "project");
  const now = Date.now();
  const attemptId = crypto.randomUUID();
  expect(
    await attempts.admit(scope, {
      id: attemptId,
      projectId: "project",
      mode: "direct",
      requestedWebsite: "https://example.com/private",
      runSeededTracking: false,
      snapshot,
      nowMs: now,
    }),
  ).toMatchObject({ kind: "created" });
  const runId = crypto.randomUUID();
  const requestId = crypto.randomUUID();
  const admission = {
    id: runId,
    projectId: "project",
    requestId,
    requestHash: "a".repeat(64),
    snapshot,
    businessSummary: "Private business summary",
    modelBackendId: null,
    modelConfigurationHash: "b".repeat(64),
    nowMs: now,
    deadlineAtMs: now + 300000,
  };
  expect(await repo.admitSetup(scope, admission)).toMatchObject({
    kind: "created",
  });
  const evidence = "Private source text";
  const candidateId = crypto.randomUUID();
  expect(
    await repo.recordSetupEvidence(scope, {
      runId,
      snapshot,
      candidates: [
        {
          id: candidateId,
          domain: "rival.com",
          name: "Rival",
          notes: "Similar services",
          source: {
            url: "https://rival.com/",
            excerpt: evidence,
            textHash: await sha256Hex(evidence),
            capturedAtMs: now + 1,
          },
          extractionMethod: "legacy_read_site",
          partialEvidence: false,
        },
      ],
      outcome: "complete",
      nowMs: now + 2,
    }),
  ).toEqual({ kind: "stored" });
  await testDb.execute(
    "insert into project_competitors (id,project_id,domain,name,notes,updated_at,updated_by) values ('canonical','project','rival.com','Edited','Other member edit','later','user')",
  );
  await testDb.execute(
    `update project_competitor_research_candidates set selected=1,acceptance_outcome='added',canonical_competitor_id='canonical',canonical_inserted_at='earlier',accepted_name='Rival',accepted_notes='Similar services' where id='${candidateId}'`,
  );
  await repo.redactSponsor("user", now + 4);
  expect(
    await testDb.execute(
      `select state,outcome,reason,active_project_id,sponsor_user_id,business_summary,request_hash from project_competitor_research_runs where id='${runId}'`,
    ),
  ).toMatchObject([
    {
      state: "finished",
      outcome: "blocked",
      reason: "privacy_erased",
      active_project_id: null,
      sponsor_user_id: null,
      business_summary: "",
      request_hash: "",
    },
  ]);
  expect(
    await testDb.execute(
      `select id from project_competitor_research_candidates where run_id='${runId}'`,
    ),
  ).toHaveLength(0);
  expect(
    await testDb.execute(
      `select state,reason,requested_website,sponsor_user_id from project_website_research_attempts where id='${attemptId}'`,
    ),
  ).toMatchObject([
    {
      state: "unknown",
      reason: "privacy_erased",
      requested_website: null,
      sponsor_user_id: null,
    },
  ]);
  expect(
    await testDb.execute(
      "select name,notes from project_competitors where id='canonical'",
    ),
  ).toMatchObject([{ name: "Edited", notes: "Other member edit" }]);
  expect(await repo.admitSetup(scope, admission)).toMatchObject({
    kind: "privacy_erased",
    runId,
  });
  expect(
    await attempts.admit(scope, {
      id: attemptId,
      projectId: "project",
      mode: "direct",
      requestedWebsite: "https://example.com/private",
      runSeededTracking: false,
      snapshot,
      nowMs: now + 5,
    }),
  ).toMatchObject({ kind: "privacy_erased" });
  expect(
    await repo.recordSetupEvidence(scope, {
      runId,
      snapshot,
      candidates: [],
      outcome: "complete",
      nowMs: now + 5,
    }),
  ).toEqual({ kind: "blocked" });
});
