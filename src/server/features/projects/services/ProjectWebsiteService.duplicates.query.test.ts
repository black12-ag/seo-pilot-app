import { afterAll, beforeEach, expect, it, vi } from "vitest";
const { testDb } = await vi.hoisted(async () => {
  const { createSiteAuthorityTestDb } =
    await import("../../site-authority/siteAuthorityTestDb");
  return { testDb: await createSiteAuthorityTestDb() };
});
vi.mock("cloudflare:workers", () => ({
  env: { DATABASE_PROVIDER: testDb.provider },
  waitUntil: vi.fn(),
}));
// Seeded tracking uses DataForSEO's default engine here.
vi.mock(
  "@/server/features/ai-visibility/services/aiVisibilityProviders",
  async (importOriginal) => ({
    ...(await importOriginal<object>()),
    defaultAiEngine: async () => "chatgpt",
  }),
);
vi.mock("@/db", () => ({ db: testDb.db }));
vi.mock("@/db/runBatch", () => ({ runBatch: testDb.runBatch }));
vi.mock("@/server/lib/runtime-env", () => ({
  usesBetterAuthServer: async () => true,
  isHostedServerAuthMode: async () => false,
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
import { WebsiteResearchAttemptRepository } from "../repositories/WebsiteResearchAttemptRepository";
import { ProjectWebsiteService } from "./ProjectWebsiteService";
import { customer } from "@/server/features/ai-visibility/services/aiVisibilityTestFixtures";
import { actor } from "../repositories/websiteResearchAttemptTestDb";
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
  if (admission.kind !== "created")
    throw new Error("expected attempt admission");
  const execution = await WebsiteResearchAttemptRepository.claimExecution(
    scope,
    attemptId,
    admission.admissionToken,
    1001,
  );
  if (execution.kind !== "claimed") throw new Error("expected execution claim");
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
  if (run.kind !== "created") throw new Error("expected setup run");
  const linked = await WebsiteResearchAttemptRepository.linkCompetitorRun(
    scope,
    attemptId,
    execution.executionToken,
    runId,
    1002,
  );
  if (linked.kind !== "linked") throw new Error("expected run link");
  const candidateId = crypto.randomUUID();
  const excerpt = "Rival is a business in the same market";
  const recorded = await CompetitorResearchRepository.recordSetupEvidence(
    scope,
    {
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
    },
  );
  if (recorded.kind !== "stored") throw new Error("expected recorded evidence");
  const completed = await WebsiteResearchAttemptRepository.complete(
    scope,
    attemptId,
    execution.executionToken,
    review,
    1201,
  );
  if (completed.kind !== "stored") throw new Error("expected review receipt");
  return {
    attemptId,
    runId,
    candidateId,
    contextVersion: snapshot.contextVersion,
  };
}

async function savedState(
  attemptId: string,
  runId: string,
  candidateId: string,
) {
  return {
    attempt: await testDb.execute(
      `select save_token,save_request_hash,applied_context_version from project_website_research_attempts where id='${attemptId}'`,
    ),
    run: await testDb.execute(
      `select review_mutation_id,review_token,applied_context_version from project_competitor_research_runs where id='${runId}'`,
    ),
    candidate: await testDb.execute(
      `select selected,acceptance_outcome,canonical_competitor_id from project_competitor_research_candidates where id='${candidateId}'`,
    ),
    canonical: await testDb.execute(
      `select id,domain,name from project_competitors where project_id='${projectId}'`,
    ),
    project: await testDb.execute(
      `select domain,ai_research_keywords from projects where id='${projectId}'`,
    ),
    overview: await testDb.execute(
      `select content from project_context_sections where project_id='${projectId}'`,
    ),
    context: await testDb.execute(
      `select context_version from content_project_state where project_id='${projectId}'`,
    ),
    tracker: await testDb.execute(
      `select id from ai_trackers where project_id='${projectId}'`,
    ),
    prompts: await testDb.execute("select id from ai_prompts"),
  };
}

it.each(["sourced then manual", "manual then sourced"])(
  "rejects %s duplicate normalized domain before any save write",
  async (order) => {
    const { attemptId, runId, candidateId, contextVersion } =
      await setupEvidence();
    const sourced = {
      name: "Sourced",
      domain: "rival.com",
      notes: "Sourced notes",
      researchCandidateId: candidateId,
    };
    const manual = {
      name: "Manual",
      domain: "https://www.rival.com/about",
      notes: "Manual notes",
    };
    const input = {
      projectId,
      ...review,
      competitors:
        order === "sourced then manual" ? [sourced, manual] : [manual, sourced],
      websiteResearchAttemptId: attemptId,
      competitorResearchRunId: runId,
      competitorResearchContextVersion: contextVersion,
    };
    const before = await savedState(attemptId, runId, candidateId);
    await expect(
      ProjectWebsiteService.save(input, customer, "user", {
        actor,
        runSeededTracking: true,
      }),
    ).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      message:
        "Each competitor domain can appear only once in a reviewed setup.",
    });
    expect(await savedState(attemptId, runId, candidateId)).toEqual(before);
    expect(vi.mocked(startRun)).not.toHaveBeenCalled();
  },
);

it("keeps legacy no-reference last-row deduplication", async () => {
  await ProjectWebsiteService.save(
    {
      projectId,
      ...review,
      competitors: [
        { name: "First", domain: "rival.com", notes: "First notes" },
        {
          name: "Last",
          domain: "https://www.rival.com/about",
          notes: "Last notes",
        },
      ],
    },
    customer,
    "user",
  );
  expect(
    await testDb.execute(
      `select domain,name,notes from project_competitors where project_id='${projectId}'`,
    ),
  ).toEqual([{ domain: "rival.com", name: "Last", notes: "Last notes" }]);
});
