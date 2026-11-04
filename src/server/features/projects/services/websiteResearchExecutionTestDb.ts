import { vi } from "vitest";
import { createSiteAuthorityTestDb } from "../../site-authority/siteAuthorityTestDb";

export const PROJECT_ID = "00000000-0000-4000-8000-000000000001";
export const customer = {
  organizationId: "organization",
  userId: "user",
  userEmail: "authority@example.com",
};
export const topics = ["SEO", "Links", "Content", "Audits", "Ranking"].map(
  (name) => ({
    name,
    prompts: [1, 2, 3, 4, 5].map((n) => `${name} question ${n}?`),
  }),
);
export const directInput = () => ({
  projectId: PROJECT_ID,
  website: "https://example.com/start",
  requestId: crypto.randomUUID(),
  confirmedPaidWork: true as const,
});
export const aiInput = () => ({
  projectId: PROJECT_ID,
  requestId: crypto.randomUUID(),
  confirmedPaidWork: true as const,
});
export type ResearchGenerateOptions = {
  tools: {
    search_competitors: {
      execute: (x: { queries: string[] }) => Promise<unknown>;
    };
    read_business_sites: {
      execute: (x: { domains: string[] }) => Promise<unknown>;
    };
  };
  onStepFinish: (x: { providerMetadata: object }) => void;
};

export async function createWebsiteResearchExecutionTestDb() {
  const testDb = await createSiteAuthorityTestDb();
  const generateText = vi.fn();
  const readSite = vi.fn();
  const search = vi.fn();
  const bill = vi.fn();
  const workflow = { get: vi.fn(), create: vi.fn() };
  async function seedSavedContext() {
    await testDb.execute(
      `insert into project_context_sections (project_id,key,content,updated_by) values ('${PROJECT_ID}','business_overview','Saved overview','user')`,
    );
    await testDb.execute(
      `insert into project_competitors (id,project_id,domain,name,updated_by) values ('rival','${PROJECT_ID}','rival.com','Rival','user')`,
    );
  }
  async function seed() {
    await testDb.seedProject();
    await testDb.execute(
      `update projects set id='${PROJECT_ID}',domain=null where id='project'`,
    );
    readSite.mockImplementation(async (url: string) => ({
      pages:
        url === "rival.com"
          ? [
              {
                url: "https://rival.com/about",
                title: "Rival",
                text: "Rival sells SEO software.",
              },
            ]
          : [
              {
                url: "https://example.com/start",
                title: "Example",
                text: "Example sells SEO software.",
              },
            ],
    }));
    search.mockResolvedValue({
      billing: { costUsd: 0.01 },
      data: [
        {
          type: "organic",
          title: "Rival",
          url: "https://rival.com/about",
          description: "SEO software",
        },
      ],
    });
    bill.mockResolvedValue({ status: "unknown" });
    workflow.get.mockResolvedValue({
      status: async () => ({ status: "complete", output: { review: null } }),
    });
    workflow.create.mockResolvedValue(undefined);
    generateText.mockImplementation(
      async (options: ResearchGenerateOptions) => {
        await options.tools.search_competitors.execute({
          queries: ["seo software"],
        });
        await options.tools.read_business_sites.execute({
          domains: ["rival.com"],
        });
        options.onStepFinish({ providerMetadata: {} });
        return {
          output: {
            overview: "Example sells SEO software to marketers.",
            competitors: [
              {
                name: "Rival",
                domain: "rival.com",
                notes: "Competing SEO software",
                sourceUrl: "https://rival.com/about",
                researchCandidateId: "00000000-0000-4000-8000-000000000099",
              },
            ],
            suggestedTopics: topics,
            suggestedKeywords: ["seo software"],
          },
        };
      },
    );
  }
  return {
    testDb,
    generateText,
    readSite,
    search,
    bill,
    workflow,
    seed,
    seedSavedContext,
  };
}
