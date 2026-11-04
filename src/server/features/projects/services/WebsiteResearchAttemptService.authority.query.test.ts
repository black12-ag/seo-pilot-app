import { afterAll, afterEach, beforeEach, expect, it, vi } from "vitest";
import type * as Ai from "ai";
import type * as Serp from "@/server/lib/dataforseo/serp";
import {
  customer,
  directInput,
  PROJECT_ID,
} from "./websiteResearchExecutionTestDb";

const { testDb, generateText, search, bill, workflow, seed } = await vi.hoisted(
  async () =>
    (
      await import("./websiteResearchExecutionTestDb")
    ).createWebsiteResearchExecutionTestDb(),
);
vi.mock("cloudflare:workers", () => ({
  env: { DATABASE_PROVIDER: testDb.provider, AI_VISIBILITY_WORKFLOW: workflow },
  waitUntil: vi.fn(),
}));
vi.mock("@/db", () => ({ db: testDb.db }));
vi.mock("@/db/runBatch", () => ({ runBatch: testDb.runBatch }));
vi.mock("@/server/lib/runtime-env", () => ({
  usesBetterAuthServer: async () => true,
  isHostedServerAuthMode: async () => false,
  getWorkersEnv: async () => ({}),
  getOptionalEnvValue: async () => null,
}));
vi.mock("@/server/lib/openrouter", () => ({
  resolveAiAccess: async () => (() => ({ apiKey: "test" }))(),
  requireAiAccess: async () => ({ apiKey: "test" }),
  buildChatAgentModel: () => ({ modelId: "test-model" }),
}));
vi.mock("ai", async (importOriginal) => ({
  NoObjectGeneratedError: (await importOriginal<typeof Ai>())
    .NoObjectGeneratedError,
  generateText,
  Output: { object: (schema: unknown) => schema },
  stepCountIs: vi.fn(),
  tool: (value: unknown) => value,
}));
vi.mock("@/server/lib/dataforseo/serp", async (importOriginal) => ({
  ...(await importOriginal<typeof Serp>()),
  fetchLiveSerp: search,
}));
vi.mock("@/server/lib/chatAgent", () => ({
  requireOpenRouterCostUsd: () => 0.03,
}));
vi.mock("@/server/billing/researchSpend", () => ({ billResearchSpend: bill }));

import { ProjectWebsiteService } from "./ProjectWebsiteService";
import { actor } from "../repositories/websiteResearchAttemptTestDb";

beforeEach(seed);
afterEach(() => vi.unstubAllGlobals());
afterAll(testDb.close);

const changes = [
  ["role", "update member set role='admin' where id='membership'"],
  ["member", "delete from member where id='membership'"],
  [
    "archive",
    `update projects set archived_at='2026-01-01' where id='${PROJECT_ID}'`,
  ],
  [
    "context",
    `insert into content_project_state (project_id,context_version,updated_at_ms) values ('${PROJECT_ID}',1,1)`,
  ],
  [
    "deadline",
    "update project_website_research_attempts set deadline_at_ms=created_at_ms+1",
  ],
] as const;

it.each(changes)(
  "stops own-site page HTTP after %s changes during sitemap",
  async (_name, mutation) => {
    const issued: string[] = [];
    let changed = false;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL) => {
        const url = String(input);
        if (url.includes("dns-query"))
          return Response.json({
            Status: 0,
            Answer: [{ type: 1, data: "93.184.216.34" }],
          });
        if (url.endsWith("/sitemap.xml")) {
          await testDb.execute(mutation);
          changed = true;
          return new Response("<urlset></urlset>");
        }
        issued.push(url);
        return new Response("<title>Example</title><p>SEO tools</p>");
      }),
    );
    const input = directInput();
    const result = await ProjectWebsiteService.researchAttempt(
      input,
      customer,
      { actor },
    ).catch(() => null);
    if (result) expect(result.status).toBe("unknown");
    expect(changed).toBe(true);
    expect(issued).toEqual([]);
    expect(generateText).not.toHaveBeenCalled();
    expect(bill).toHaveBeenCalledTimes(1);
    expect(
      await testDb.execute(
        `select state from project_website_research_attempts where id='${input.requestId}'`,
      ),
    ).toMatchObject([{ state: "unknown" }]);
  },
);

it("stops candidate page HTTP after role loss during its sitemap", async () => {
  await testDb.execute(
    `insert into project_context_sections (project_id,key,content,updated_by) values ('${PROJECT_ID}','business_overview','Saved overview','user')`,
  );
  const issued: string[] = [];
  let changed = false;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url.includes("dns-query"))
        return Response.json({
          Status: 0,
          Answer: [{ type: 1, data: "93.184.216.34" }],
        });
      if (url.endsWith("/sitemap.xml")) {
        await testDb.execute(
          "update member set role='admin' where id='membership'",
        );
        changed = true;
        return new Response("<urlset></urlset>");
      }
      issued.push(url);
      return new Response("<title>Rival</title><p>SEO software</p>");
    }),
  );
  const input = directInput();
  await expect(
    ProjectWebsiteService.researchAttempt(input, customer, { actor }),
  ).rejects.toThrow();
  expect(changed).toBe(true);
  expect(issued).toEqual([]);
  expect(search).toHaveBeenCalledTimes(1);
  expect(generateText).toHaveBeenCalledTimes(1);
  expect(bill).toHaveBeenCalledTimes(1);
  expect(bill.mock.calls[0]?.[1]).toEqual([
    {
      provider: "dataforseo",
      creditFeature: "keyword_research",
      operation: "project_website_research",
      costUsd: 0.01,
    },
  ]);
  expect(
    await testDb.execute(
      "select id from project_competitor_research_candidates",
    ),
  ).toHaveLength(0);
});
