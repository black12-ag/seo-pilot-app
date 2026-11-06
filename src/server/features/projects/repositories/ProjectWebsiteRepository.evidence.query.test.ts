import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
const { testDb } = await vi.hoisted(async () => {
  const { createSiteAuthorityTestDb } =
    await import("../../site-authority/siteAuthorityTestDb");
  return { testDb: await createSiteAuthorityTestDb() };
});
vi.mock("cloudflare:workers", () => ({
  env: { DATABASE_PROVIDER: testDb.provider },
  waitUntil: vi.fn(),
}));
vi.mock("@/db", () => ({ db: testDb.db }));
vi.mock("@/db/runBatch", () => ({ runBatch: testDb.runBatch }));
vi.mock("@/server/lib/runtime-env", () => ({
  usesBetterAuthServer: async () => true,
  isHostedServerAuthMode: async () => false,
}));
vi.mock("@/server/lib/provider-access", () => ({
  hasDataforseoAccess: async () => true,
}));
vi.mock("@/server/features/ai-visibility/services/aiVisibilityRuns", () => ({
  startRun: vi.fn(),
}));
vi.mock("@/server/features/projects/services/websiteResearch", () => ({
  researchWebsite: vi.fn(),
}));
vi.mock("@/server/billing/subscription", () => ({
  checkUsageCreditsDepleted: vi.fn(),
}));

import { sha256Hex } from "@/server/lib/audit/ids";
import { CompetitorResearchRepository } from "@/server/features/competitor-research/repositories/CompetitorResearchRepository";
import { WebsiteResearchAttemptRepository } from "./WebsiteResearchAttemptRepository";
import { ProjectWebsiteService } from "../services/ProjectWebsiteService";
import { customer } from "@/server/features/ai-visibility/services/aiVisibilityTestFixtures";
import { actor } from "./websiteResearchAttemptTestDb";
import { startRun } from "@/server/features/ai-visibility/services/aiVisibilityRuns";

const projectId = "c9bfb889-f75e-4786-9499-3742e73b1234";
const review = {
  name: "Project",
  domain: "example.com",
  overview: "Observed website overview",
  competitors: [
    {
      name: "Rival",
      domain: "rival.com",
      notes: "Original notes",
      sourceUrl: "https://rival.com/about",
    },
  ],
  preserveCompetitors: false,
  suggestedTopics: [
    {
      name: "Search topic",
      prompts: ["One?", "Two?", "Three?", "Four?", "Five?"],
    },
  ],
  suggestedKeywords: ["search keyword"],
};

beforeEach(async () => {
  await testDb.seedProject();
  await testDb.execute(
    `update projects set id='${projectId}',domain=null where id='project'`,
  );
});
afterAll(testDb.close);
async function setupEvidence() {
  const { scope, snapshot } = await CompetitorResearchRepository.getSnapshot(
    actor,
    projectId,
  );
  const attemptId = crypto.randomUUID();
  const admission = await WebsiteResearchAttemptRepository.admit(scope, {
    id: attemptId,
    projectId,
    mode: "direct",
    requestedWebsite: "https://example.com/start",
    runSeededTracking: true,
    snapshot,
    nowMs: 1000,
  });
  if (admission.kind !== "created") throw new Error("expected attempt");
  const execution = await WebsiteResearchAttemptRepository.claimExecution(
    scope,
    attemptId,
    admission.admissionToken,
    1001,
  );
  if (execution.kind !== "claimed") throw new Error("expected execution");
  const runId = crypto.randomUUID();
  const run = await CompetitorResearchRepository.admitSetup(scope, {
    id: runId,
    projectId,
    requestId: attemptId,
    requestHash: "a".repeat(64),
    snapshot,
    businessSummary: "Project",
    modelBackendId: null,
    modelConfigurationHash: "b".repeat(64),
    nowMs: 1001,
    deadlineAtMs: 300000,
  });
  if (run.kind !== "created") throw new Error("expected run");
  await WebsiteResearchAttemptRepository.linkCompetitorRun(
    scope,
    attemptId,
    execution.executionToken,
    runId,
    1002,
  );
  const candidateId = crypto.randomUUID();
  const excerpt = "Rival is a business in the same market";
  expect(
    await CompetitorResearchRepository.recordSetupEvidence(scope, {
      runId,
      snapshot,
      outcome: "complete",
      nowMs: 1200,
      candidates: [
        {
          id: candidateId,
          domain: "rival.com",
          name: "Rival",
          notes: "Original notes",
          source: {
            url: "https://rival.com/about",
            excerpt,
            textHash: await sha256Hex(excerpt),
            capturedAtMs: 1100,
          },
          extractionMethod: "legacy_read_site",
          partialEvidence: false,
        },
      ],
    }),
  ).toMatchObject({ kind: "stored" });
  expect(
    await WebsiteResearchAttemptRepository.complete(
      scope,
      attemptId,
      execution.executionToken,
      review,
      1201,
    ),
  ).toMatchObject({ kind: "stored" });
  const input = {
    projectId,
    ...review,
    competitors: [
      {
        name: "Edited rival",
        domain: "rival.com",
        notes: "Edited notes",
        researchCandidateId: candidateId,
      },
    ],
    websiteResearchAttemptId: attemptId,
    competitorResearchRunId: runId,
    competitorResearchContextVersion: snapshot.contextVersion,
  };
  return { input, attemptId, runId, candidateId };
}

function save(input: Parameters<typeof ProjectWebsiteService.save>[0]) {
  return ProjectWebsiteService.save(input, customer, "user", {
    actor,
    runSeededTracking: true,
  });
}

async function expectUnsaved(attemptId: string) {
  expect(
    await testDb.execute(
      `select save_token from project_website_research_attempts where id='${attemptId}'`,
    ),
  ).toEqual([{ save_token: null }]);
  expect(
    await testDb.execute(
      `select domain,ai_research_keywords from projects where id='${projectId}'`,
    ),
  ).toEqual([{ domain: null, ai_research_keywords: null }]);
}
describe("reviewed website setup save", () => {
  it("fills null domain and setup fields, linking only its own inserted canonical ID", async () => {
    const { input, candidateId } = await setupEvidence();
    await save(input);
    expect(
      await testDb.execute(
        `select domain,ai_research_keywords from projects where id='${projectId}'`,
      ),
    ).toEqual([
      {
        domain: "example.com",
        ai_research_keywords: "Search topic\nsearch keyword",
      },
    ]);
    expect(
      await testDb.execute(
        `select content from project_context_sections where project_id='${projectId}'`,
      ),
    ).toMatchObject([{ content: review.overview }]);
    const competitors = await testDb.execute(
      `select id,domain,name,notes from project_competitors where project_id='${projectId}'`,
    );
    expect(competitors).toMatchObject([
      { domain: "rival.com", name: "Edited rival", notes: "Edited notes" },
    ]);
    expect(
      await testDb.execute(
        `select selected,acceptance_outcome,canonical_competitor_id,accepted_name,accepted_notes from project_competitor_research_candidates where id='${candidateId}'`,
      ),
    ).toEqual([
      {
        selected: 1,
        acceptance_outcome: "added",
        canonical_competitor_id: String(competitors[0]?.id),
        accepted_name: "Edited rival",
        accepted_notes: "Edited notes",
      },
    ]);
    expect(
      await testDb.execute(
        `select context_version from content_project_state where project_id='${projectId}'`,
      ),
    ).toEqual([{ context_version: 1 }]);
  });

  it("replays its exact normalized payload after context drift without writes or tracking restart", async () => {
    const { input, runId } = await setupEvidence();
    await Promise.all([save(input), save(input)]);
    const calls = vi.mocked(startRun).mock.calls.length;
    expect(calls).toBe(1);
    await testDb.execute(
      `delete from project_competitors where project_id='${projectId}'`,
    );
    await testDb.execute(
      `update content_project_state set context_version=8 where project_id='${projectId}'`,
    );
    await save(input);
    expect(
      await testDb.execute(
        `select count(*) as total from project_competitors where project_id='${projectId}'`,
      ),
    ).toEqual([{ total: testDb.pg ? "0" : 0 }]);
    expect(
      await testDb.execute(
        `select context_version from content_project_state where project_id='${projectId}'`,
      ),
    ).toEqual([{ context_version: 8 }]);
    expect(vi.mocked(startRun).mock.calls.length).toBe(calls);
    await expect(
      ProjectWebsiteService.save(
        { ...input, overview: "Changed" },
        customer,
        "user",
        { actor, runSeededTracking: true },
      ),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await testDb.execute(
      `update project_competitor_research_runs set redacted_at_ms=1300 where id='${runId}'`,
    );
    await expect(save(input)).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it.each([
    [
      "foreign candidate",
      (input: Awaited<ReturnType<typeof setupEvidence>>["input"]) => ({
        ...input,
        competitors: [
          { ...input.competitors[0], researchCandidateId: crypto.randomUUID() },
        ],
      }),
    ],
    [
      "edited candidate domain",
      (input: Awaited<ReturnType<typeof setupEvidence>>["input"]) => ({
        ...input,
        competitors: [{ ...input.competitors[0], domain: "different.com" }],
      }),
    ],
    [
      "foreign attempt",
      (input: Awaited<ReturnType<typeof setupEvidence>>["input"]) => ({
        ...input,
        websiteResearchAttemptId: crypto.randomUUID(),
      }),
    ],
    [
      "foreign run",
      (input: Awaited<ReturnType<typeof setupEvidence>>["input"]) => ({
        ...input,
        competitorResearchRunId: crypto.randomUUID(),
      }),
    ],
    [
      "stale context reference",
      (input: Awaited<ReturnType<typeof setupEvidence>>["input"]) => ({
        ...input,
        competitorResearchContextVersion:
          input.competitorResearchContextVersion + 1,
      }),
    ],
    [
      "partial references",
      (input: Awaited<ReturnType<typeof setupEvidence>>["input"]) => ({
        ...input,
        websiteResearchAttemptId: undefined,
      }),
    ],
  ] as const)("rejects %s without a setup write", async (_name, change) => {
    const { input, attemptId } = await setupEvidence();
    await expect(save(change(input))).rejects.toThrow();
    await expectUnsaved(attemptId);
  });

  it.each([
    [
      "manual winner",
      `insert into project_competitors (id,project_id,domain,updated_by) values ('winner','${projectId}','manual.com','user')`,
    ],
    [
      "context drift",
      `insert into content_project_state (project_id,context_version) values ('${projectId}',1) on conflict (project_id) do update set context_version=1`,
    ],
    [
      "candidate source change",
      "update project_competitor_research_candidates set source_url='https://other.com/'",
    ],
    [
      "run redaction",
      "update project_competitor_research_runs set redacted_at_ms=1300",
    ],
    [
      "market change",
      `update projects set location_code=123 where id='${projectId}'`,
    ],
    [
      "archive",
      `update projects set archived_at='2026-11-03' where id='${projectId}'`,
    ],
  ] as const)("refuses %s at the batch boundary", async (_name, mutation) => {
    const { input, attemptId } = await setupEvidence();
    testDb.beforeNextBatch(() =>
      testDb.execute(mutation).then(() => undefined),
    );
    await expect(save(input)).rejects.toThrow();
    await expectUnsaved(attemptId);
  });

  it.each([
    [
      "redacted attempt",
      "update project_website_research_attempts set redacted_at_ms=1300",
    ],
    [
      "restored attempt",
      "update project_website_research_attempts set reason='restored',sponsor_user_id=null,sponsor_member_id=null,sponsor_role=null,execution_token=null",
    ],
    [
      "changed sponsor",
      "update project_website_research_attempts set sponsor_user_id=null",
    ],
    ["removed member", "delete from member where id='membership'"],
    [
      "changed member role",
      "update member set role='member' where id='membership'",
    ],
    [
      "missing source",
      "update project_competitor_research_candidates set source_url=null",
    ],
  ] as const)("refuses %s before setup mutation", async (_name, mutation) => {
    const { input, attemptId } = await setupEvidence();
    await testDb.execute(mutation);
    await expect(save(input)).rejects.toThrow();
    await expectUnsaved(attemptId);
  });

  it("rolls back when the sponsor role changes inside the batch after the claim", async () => {
    const { input, attemptId } = await setupEvidence();
    testDb.mutateMembershipInNextBatchAt(8, "member");
    await expect(save(input)).rejects.toThrow();
    await expectUnsaved(attemptId);
    expect(
      await testDb.execute(`select role from member where id='membership'`),
    ).toEqual([{ role: "owner" }]);
  });

  it("rolls back claim, domain, competitor, overview, and context on a later batch failure", async () => {
    const { input, attemptId } = await setupEvidence();
    testDb.failNextBatchAt(18);
    await expect(save(input)).rejects.toThrow();
    await expectUnsaved(attemptId);
    expect(
      await testDb.execute(
        `select count(*) as total from project_competitors where project_id='${projectId}'`,
      ),
    ).toEqual([{ total: testDb.pg ? "0" : 0 }]);
  });
});
