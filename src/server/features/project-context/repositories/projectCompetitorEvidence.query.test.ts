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
  usesBetterAuthServer: async () => true,
}));

import { sha256Hex } from "@/server/lib/audit/ids";
import { CompetitorResearchRepository } from "@/server/features/competitor-research/repositories/CompetitorResearchRepository";
import { listProjectCompetitorEvidence } from "./projectCompetitorEvidence.query";
import { actor } from "@/server/features/projects/repositories/websiteResearchAttemptTestDb";

const projectId = "ccd86b7c-9726-4853-91bb-9eb3e481ba7a";
beforeEach(async () => {
  await testDb.seedProject();
  await testDb.execute(
    `update projects set id='${projectId}' where id='project'`,
  );
});
afterAll(testDb.close);

async function sourcedCompetitor() {
  const { scope, snapshot } = await CompetitorResearchRepository.getSnapshot(
    actor,
    projectId,
  );
  const runId = crypto.randomUUID();
  const candidateId = crypto.randomUUID();
  expect(
    await CompetitorResearchRepository.admitSetup(scope, {
      id: runId,
      projectId,
      requestId: crypto.randomUUID(),
      requestHash: "a".repeat(64),
      snapshot,
      businessSummary: "Project",
      modelBackendId: null,
      modelConfigurationHash: "b".repeat(64),
      nowMs: 1000,
      deadlineAtMs: 300000,
    }),
  ).toMatchObject({ kind: "created" });
  const excerpt = "Rival provides similar services";
  expect(
    await CompetitorResearchRepository.recordSetupEvidence(scope, {
      runId,
      snapshot,
      outcome: "complete",
      nowMs: 1100,
      candidates: [
        {
          id: candidateId,
          domain: "rival.com",
          name: "Rival",
          notes: "Similar",
          source: {
            url: "https://rival.com/about",
            excerpt,
            textHash: await sha256Hex(excerpt),
            capturedAtMs: 1050,
          },
          extractionMethod: "legacy_read_site",
          partialEvidence: false,
        },
      ],
    }),
  ).toMatchObject({ kind: "stored" });
  expect(
    await CompetitorResearchRepository.accept(
      scope,
      {
        projectId,
        runId,
        mutationId: crypto.randomUUID(),
        expectedContextVersion: snapshot.contextVersion,
        selections: [{ candidateId, name: "Rival", notes: "Edited review" }],
      },
      "c".repeat(64),
      1200,
    ),
  ).toMatchObject({ ok: true });
  return { runId, candidateId };
}

it("exposes only an exact canonical ID, project and domain source link", async () => {
  const { runId, candidateId } = await sourcedCompetitor();
  const [source] = await listProjectCompetitorEvidence(projectId);
  expect(source).toMatchObject({
    runId,
    candidateId,
    sourceUrl: "https://rival.com/about",
    capturedAtMs: 1050,
    method: "legacy_read_site",
  });
  const canonicalId = source?.canonicalId;
  await testDb.execute(
    `update project_competitors set name='Manually edited' where id='${canonicalId}'`,
  );
  expect(await listProjectCompetitorEvidence(projectId)).toHaveLength(1);
  await testDb.execute(
    `update project_competitors set domain='changed.com' where id='${canonicalId}'`,
  );
  expect(await listProjectCompetitorEvidence(projectId)).toEqual([]);
  await testDb.execute(
    `update project_competitors set domain='rival.com' where id='${canonicalId}'`,
  );
  expect(await listProjectCompetitorEvidence(projectId)).toHaveLength(1);
  await testDb.execute(
    `delete from project_competitors where id='${canonicalId}'`,
  );
  await testDb.execute(
    `insert into project_competitors (id,project_id,domain,updated_by) values ('readded','${projectId}','rival.com','user')`,
  );
  expect(await listProjectCompetitorEvidence(projectId)).toEqual([]);
});

it("hides a source after its parent run is redacted", async () => {
  const { runId } = await sourcedCompetitor();
  await testDb.execute(
    "update project_competitor_research_candidates set source_url=null",
  );
  expect(await listProjectCompetitorEvidence(projectId)).toEqual([]);
  await testDb.execute(
    "update project_competitor_research_candidates set source_url='https://rival.com/about'",
  );
  expect(await listProjectCompetitorEvidence(projectId)).toHaveLength(1);
  await testDb.execute(
    `update project_competitor_research_runs set redacted_at_ms=1300 where id='${runId}'`,
  );
  expect(await listProjectCompetitorEvidence(projectId)).toEqual([]);
});
