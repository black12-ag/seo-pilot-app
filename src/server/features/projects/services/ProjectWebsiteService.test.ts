import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
const { testDb, betterAuth } = await vi.hoisted(async () => {
  const { createSiteAuthorityTestDb } =
    await import("../../site-authority/siteAuthorityTestDb");
  return {
    testDb: await createSiteAuthorityTestDb(),
    betterAuth: vi.fn(async () => true),
  };
});
vi.mock("cloudflare:workers", () => ({
  env: { DATABASE_PROVIDER: testDb.provider },
  DurableObject: vi.fn(),
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
vi.mock("@/server/features/ai-visibility/services/aiVisibilityRuns", () => ({
  startRun: vi.fn(),
}));
vi.mock("@/server/features/projects/services/websiteResearch", () => ({
  researchWebsite: vi.fn(),
}));
vi.mock("@/server/billing/subscription", () => ({
  checkUsageCreditsDepleted: vi.fn(),
}));
vi.mock("@/server/lib/runtime-env", () => ({
  isHostedServerAuthMode: async () => false,
  usesBetterAuthServer: betterAuth,
}));
import { projectCompetitors } from "@/db/schema";
import { ProjectWebsiteService } from "./ProjectWebsiteService";
import { researchWebsite } from "./websiteResearch";
import { startAiResearchAttemptSetup } from "@/server/features/ai-visibility/services/aiResearchKeywords";
import { CompetitorResearchRepository } from "@/server/features/competitor-research/repositories/CompetitorResearchRepository";
import { WebsiteResearchAttemptRepository } from "../repositories/WebsiteResearchAttemptRepository";
import { actor } from "../repositories/websiteResearchAttemptTestDb";
import { customer } from "@/server/features/ai-visibility/services/aiVisibilityTestFixtures";

const projectId = "4a5b6c7d-0000-4000-8000-000000000000";
const project = { name: "Saved name" };
const accepted = {
  projectId,
  name: "Researched name",
  domain: "researched.com",
  overview: "Researched overview".padEnd(4000, "."),
  competitors: [
    {
      name: "Researched rival",
      domain: "rival.com",
      notes: "Researched notes",
    },
    { name: "New rival", domain: "new-rival.com", notes: "New notes" },
    // Cross the D1 chunk boundary: earlier inserts must not block later ones.
    ...Array.from({ length: 10 }, (_, index) => ({
      name: `Extra rival ${index}`,
      domain: `extra-rival-${index}.com`,
      notes: "",
    })),
  ],
  suggestedTopics: [
    {
      name: "new keyword",
      prompts: [1, 2, 3, 4, 5].map((n) => `New question ${n}?`),
    },
  ],
  suggestedKeywords: ["site audit"],
};

afterAll(testDb.close);
beforeEach(async () => {
  betterAuth.mockResolvedValue(true);
  await testDb.seedProject();
  await testDb.executeMultiple(`DELETE FROM projects;
    INSERT INTO projects (id, organization_id, name, location_code, language_code) VALUES ('${projectId}', '${customer.organizationId}', '${project.name}', 2840, 'en');`);
});

it("refuses unclassified legacy status before admitting new direct research", async () => {
  await expect(
    ProjectWebsiteService.researchAttempt(
      {
        projectId,
        website: "https://researched.com",
        requestId: crypto.randomUUID(),
        confirmedPaidWork: true,
      },
      customer,
      { actor },
    ),
  ).rejects.toMatchObject({ code: "UPSTREAM_UNAVAILABLE" });
  expect(
    await testDb.execute("select id from project_website_research_attempts"),
  ).toHaveLength(0);
  expect(researchWebsite).not.toHaveBeenCalled();
});

it("refuses the old direct provider path for a marked project in delegated mode", async () => {
  betterAuth.mockResolvedValue(false);
  await testDb.execute(
    `update projects set legacy_setup_absence_proven=1 where id='${projectId}'`,
  );
  await expect(
    ProjectWebsiteService.research(
      projectId,
      "https://researched.com",
      customer,
    ),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  expect(researchWebsite).not.toHaveBeenCalled();
});

it.each(["direct", "ai_setup"] as const)(
  "returns %s privacy erasure before uncertain legacy Workflow lookup",
  async (mode) => {
    if (mode === "ai_setup")
      await testDb.execute(
        `update projects set domain='researched.com' where id='${projectId}'`,
      );
    const { scope, snapshot } = await CompetitorResearchRepository.getSnapshot(
      actor,
      projectId,
    );
    const requestId = crypto.randomUUID();
    expect(
      (
        await WebsiteResearchAttemptRepository.admit(scope, {
          id: requestId,
          projectId,
          mode,
          requestedWebsite: "https://researched.com",
          runSeededTracking: false,
          snapshot,
          nowMs: 1000,
        })
      ).kind,
    ).toBe("created");
    await testDb.execute(
      `update project_website_research_attempts set redacted_at_ms=1001,request_hash=null,requested_website=null,requested_domain=null,sponsor_user_id=null,sponsor_member_id=null,sponsor_role=null,active_project_id=null,state='unknown',finished_at_ms=1001 where id='${requestId}'`,
    );
    const result =
      mode === "direct"
        ? await ProjectWebsiteService.researchAttempt(
            {
              projectId,
              website: "https://researched.com",
              requestId,
              confirmedPaidWork: true,
            },
            customer,
            { actor },
          )
        : await startAiResearchAttemptSetup(
            { projectId, requestId, confirmedPaidWork: true },
            customer,
            { actor },
          );
    expect(result.status).toBe("unavailable");
    expect(JSON.stringify(result)).toContain("privacy_erased");
    expect(researchWebsite).not.toHaveBeenCalled();
  },
);

async function saveContext() {
  await testDb.executeMultiple(`INSERT INTO project_context_sections (project_id, key, content, updated_by) VALUES ('${projectId}', 'business_overview', 'User overview', 'user');
    INSERT INTO project_competitors (id, project_id, domain, name, notes, updated_by) VALUES ('saved', '${projectId}', 'rival.com', 'User rival', 'User notes', 'user');`);
}

describe("ProjectWebsiteService.save", () => {
  it("keeps an existing competitor list on a sourced attempt with no competitor run", async () => {
    await testDb.execute(
      `insert into project_competitors (id,project_id,domain,updated_by) values ('manual','${projectId}','manual.com','user')`,
    );
    const { scope, snapshot } = await CompetitorResearchRepository.getSnapshot(
      actor,
      projectId,
    );
    const attemptId = crypto.randomUUID();
    const admitted = await WebsiteResearchAttemptRepository.admit(scope, {
      id: attemptId,
      projectId,
      mode: "direct",
      requestedWebsite: "https://researched.com/",
      runSeededTracking: false,
      snapshot,
      nowMs: 1000,
    });
    if (admitted.kind !== "created") throw new Error("expected admission");
    const claimed = await WebsiteResearchAttemptRepository.claimExecution(
      scope,
      attemptId,
      admitted.admissionToken,
      1001,
    );
    if (claimed.kind !== "claimed") throw new Error("expected claim");
    await WebsiteResearchAttemptRepository.complete(
      scope,
      attemptId,
      claimed.executionToken,
      {
        name: project.name,
        domain: "researched.com",
        overview: accepted.overview,
        competitors: [],
        preserveCompetitors: true,
        suggestedTopics: accepted.suggestedTopics,
        suggestedKeywords: accepted.suggestedKeywords,
      },
      1002,
    );
    await ProjectWebsiteService.save(
      {
        ...accepted,
        name: project.name,
        competitors: [],
        websiteResearchAttemptId: attemptId,
      },
      customer,
      "user",
      { actor },
    );
    expect(
      await testDb.execute(
        `select id,domain from project_competitors where project_id='${projectId}'`,
      ),
    ).toEqual([{ id: "manual", domain: "manual.com" }]);
    expect(
      await testDb.execute(
        `select domain from projects where id='${projectId}'`,
      ),
    ).toEqual([{ domain: "researched.com" }]);
  });

  it("requires a trusted actor when a source reference is supplied", async () => {
    await expect(
      ProjectWebsiteService.save(
        { ...accepted, websiteResearchAttemptId: crypto.randomUUID() },
        customer,
        "user",
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await testDb.execute("SELECT domain FROM projects")).toEqual([
      { domain: null },
    ]);
  });

  it("fills missing fields without replacing an existing project name", async () => {
    await ProjectWebsiteService.save(accepted, customer, "user");
    expect(
      await testDb.execute(
        "SELECT name, domain, ai_research_keywords FROM projects",
      ),
    ).toEqual([
      {
        name: project.name,
        domain: accepted.domain,
        ai_research_keywords: "new keyword\nsite audit",
      },
    ]);
    expect(
      new Set(
        (
          await testDb.db
            .select({ domain: projectCompetitors.domain })
            .from(projectCompetitors)
        ).map((row) => row.domain),
      ),
    ).toEqual(new Set(accepted.competitors.map((row) => row.domain)));
    expect(
      (await testDb.execute("SELECT content FROM project_context_sections"))[0]
        ?.content,
    ).toBe(accepted.overview);
    expect(
      await testDb.execute("SELECT context_version FROM content_project_state"),
    ).toMatchObject([{ context_version: 1 }]);
  });

  it.each(["before review", "during save"])(
    "preserves context saved %s, including the whole competitor list",
    async (timing) => {
      const edit = async () => {
        await saveContext();
        await testDb.execute(
          "UPDATE projects SET name = 'User name', domain = 'user.com', ai_research_keywords = 'user keyword'",
        );
      };
      if (timing === "before review") {
        await edit();
      } else testDb.beforeNextBatch(edit);

      await ProjectWebsiteService.save(accepted, customer, "user");

      expect(
        await testDb.execute(
          "SELECT name, domain, ai_research_keywords FROM projects",
        ),
      ).toEqual([
        {
          name: "User name",
          domain: "user.com",
          ai_research_keywords: "user keyword",
        },
      ]);
      expect(
        await testDb.execute(
          "SELECT content, updated_by FROM project_context_sections",
        ),
      ).toEqual([{ content: "User overview", updated_by: "user" }]);
      expect(
        await testDb.execute(
          "SELECT domain, name, notes FROM project_competitors",
        ),
      ).toEqual([
        { domain: "rival.com", name: "User rival", notes: "User notes" },
      ]);
    },
  );
});
