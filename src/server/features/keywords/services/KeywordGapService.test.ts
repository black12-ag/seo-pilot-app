import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { KeywordGapService } from "./KeywordGapService";
import {
  customer,
  project,
  requestBody,
  stubProvider,
} from "./keywordGapTestProvider";

const mocks = vi.hoisted(() => ({
  hasAccess: vi.fn<() => Promise<boolean>>(),
  cache: new Map<string, unknown>(),
  setCached: vi.fn(),
}));

vi.mock("cloudflare:workers", () => ({
  waitUntil: (promise: Promise<unknown>) => void promise,
}));
vi.mock("@/server/lib/r2-cache", () => ({
  buildCacheKey: async (prefix: string, params: Record<string, unknown>) =>
    `${prefix}:${JSON.stringify(params)}`,
  getCached: async (key: string) => mocks.cache.get(key) ?? null,
  setCached: mocks.setCached,
}));
vi.mock("@/server/lib/provider-access", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  hasDataforseoAccess: mocks.hasAccess,
}));
vi.mock("@/server/lib/runtime-env", () => ({
  getOptionalEnvValue: vi.fn(async () => undefined),
  getRequiredEnvValue: vi.fn(async () => "test-api-key"),
  isHostedServerAuthMode: async () => false,
}));
vi.mock(
  "@/server/features/project-context/repositories/ProjectContextRepository",
  () => ({ ProjectContextRepository: {} }),
);

function ready(result: Awaited<ReturnType<typeof KeywordGapService.run>>) {
  if (result.status !== "ready") throw new Error("Expected a ready result");
  return result;
}

beforeEach(() => {
  mocks.cache.clear();
  mocks.hasAccess.mockResolvedValue(true);
  mocks.setCached.mockImplementation(async (key: string, value: unknown) => {
    mocks.cache.set(key, value);
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

it("splits keywords into competitor-only and shared, with positions", async () => {
  stubProvider({
    "example.com": {
      items: [
        {
          keyword: "Shared Term",
          volume: 500,
          position: 4,
          url: "https://example.com/a",
        },
        { keyword: "only ours", volume: 900, position: 2 },
      ],
    },
    "rival.com": {
      items: [
        {
          keyword: "shared term",
          volume: 500,
          difficulty: 30,
          position: 7,
          url: "https://rival.com/a",
        },
        { keyword: "their term", volume: 800, position: 1 },
        { keyword: "no volume term", position: 3 },
      ],
    },
    "other.com": { items: [{ keyword: "their term", position: 9 }] },
  });

  const result = ready(
    await KeywordGapService.run(
      { project, competitors: ["rival.com", "other.com"] },
      customer,
    ),
  );

  expect(result.missing.map((row) => row.keyword)).toEqual([
    "their term",
    "no volume term",
  ]);
  expect(result.missing[0]).toMatchObject({
    searchVolume: 800,
    projectRanks: false,
    projectPosition: null,
    competitors: [
      { domain: "rival.com", ranks: true, position: 1 },
      { domain: "other.com", ranks: true, position: 9 },
    ],
  });
  // Unknown metrics stay unknown.
  expect(result.missing[1]).toMatchObject({
    searchVolume: null,
    keywordDifficulty: null,
  });
  expect(result.shared).toHaveLength(1);
  expect(result.shared[0]).toMatchObject({
    keyword: "Shared Term",
    searchVolume: 500,
    keywordDifficulty: 30,
    projectRanks: true,
    projectPosition: 4,
    projectUrl: "https://example.com/a",
    competitors: [
      { domain: "rival.com", ranks: true, position: 7 },
      { domain: "other.com", ranks: false, position: null },
    ],
  });
});

it("labels results with market and fetch date, and sends that market", async () => {
  const fetchMock = stubProvider({
    "example.com": { items: [] },
    "rival.com": { items: [] },
  });

  const result = ready(
    await KeywordGapService.run(
      { project, competitors: ["rival.com"] },
      customer,
    ),
  );

  expect(result.market).toEqual({ locationCode: 2826, languageCode: "en" });
  expect(result.isProjectMarket).toBe(true);
  expect(Date.parse(result.project.fetchedAt)).not.toBeNaN();
  expect(Date.parse(result.competitors[0]?.fetchedAt ?? "")).not.toBeNaN();
  expect(requestBody(fetchMock.mock.calls[0])).toMatchObject({
    target: "example.com",
    location_code: 2826,
    language_code: "en",
    limit: 500,
    order_by: ["ranked_serp_element.serp_item.etv,desc"],
    item_types: ["organic"],
  });
  expect(fetchMock.mock.calls[0]?.[0]).toEqual(
    expect.stringContaining("/v3/dataforseo_labs/google/ranked_keywords/live"),
  );
});

it("says when the check was not complete, instead of implying no ranking", async () => {
  const fullPage = Array.from({ length: 500 }, (_, index) => ({
    keyword: `term ${index}`,
    position: 5,
  }));
  stubProvider({
    "example.com": { items: fullPage, total: 3200 },
    "rival.com": { items: [{ keyword: "their term", position: 1 }] },
  });

  const result = ready(
    await KeywordGapService.run(
      { project, competitors: ["rival.com"] },
      customer,
    ),
  );

  expect(result.project).toMatchObject({
    fetchedRows: 500,
    totalCount: 3200,
    complete: false,
  });
  expect(result.competitors[0]?.complete).toBe(true);
});

it("is only complete when the rows cover the provider's total", async () => {
  stubProvider({
    "example.com": { items: [{ keyword: "a" }], total: 9000 },
    "rival.com": { items: [{ keyword: "b" }], total: 1 },
  });

  const result = ready(
    await KeywordGapService.run(
      { project, competitors: ["rival.com"] },
      customer,
    ),
  );

  expect(result.project).toMatchObject({
    fetchedRows: 1,
    totalCount: 9000,
    complete: false,
  });
  expect(result.competitors[0]?.complete).toBe(true);
});

it("reuses a 12 hour answer for each domain, including an empty one", async () => {
  const fetchMock = stubProvider({
    "example.com": { items: [] },
    "rival.com": { items: [{ keyword: "their term", position: 1 }] },
    "other.com": { items: [] },
  });

  const first = ready(
    await KeywordGapService.run(
      { project, competitors: ["rival.com"] },
      customer,
    ),
  );
  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(mocks.setCached).toHaveBeenCalledWith(
    expect.any(String),
    expect.anything(),
    43200,
  );

  const repeat = ready(
    await KeywordGapService.run(
      { project, competitors: ["rival.com"] },
      customer,
    ),
  );
  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(repeat).toEqual(first);

  // Adding a competitor only pays for the new domain.
  await KeywordGapService.run(
    { project, competitors: ["rival.com", "other.com"] },
    customer,
  );
  expect(fetchMock).toHaveBeenCalledTimes(3);
});

it("scopes cached answers to the organization and project", async () => {
  const fetchMock = stubProvider({
    "example.com": { items: [] },
    "rival.com": { items: [] },
  });
  const input = { project, competitors: ["rival.com"] };

  await KeywordGapService.run(input, customer);
  await KeywordGapService.run(input, { ...customer, organizationId: "org-2" });
  await KeywordGapService.run(
    { ...input, project: { ...project, id: "project-2" } },
    customer,
  );

  expect(fetchMock).toHaveBeenCalledTimes(6);
});

it("reports needs setup without calling the provider", async () => {
  const fetchMock = stubProvider({});

  await expect(
    KeywordGapService.run(
      { project: { ...project, domain: null }, competitors: ["rival.com"] },
      customer,
    ),
  ).resolves.toEqual({
    status: "needs_setup",
    reason: "project_domain_missing",
  });

  mocks.hasAccess.mockResolvedValue(false);
  await expect(
    KeywordGapService.run({ project, competitors: ["rival.com"] }, customer),
  ).resolves.toEqual({
    status: "needs_setup",
    reason: "provider_not_configured",
  });

  expect(fetchMock).not.toHaveBeenCalled();
});

it("refuses the project's own domain as a competitor", async () => {
  const fetchMock = stubProvider({});
  await expect(
    KeywordGapService.run(
      { project, competitors: ["www.example.com"] },
      customer,
    ),
  ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  expect(fetchMock).not.toHaveBeenCalled();
});

it("does not cache a failed domain, and keeps the answers already paid for", async () => {
  const fetchMock = stubProvider({
    "example.com": { items: [] },
    "rival.com": { fail: true },
  });
  const input = { project, competitors: ["rival.com"] };

  await expect(KeywordGapService.run(input, customer)).rejects.toBeInstanceOf(
    Error,
  );
  expect(mocks.setCached).toHaveBeenCalledOnce();

  stubProvider({ "rival.com": { items: [] } });
  await expect(KeywordGapService.run(input, customer)).resolves.toMatchObject({
    status: "ready",
  });
  expect(fetchMock).toHaveBeenCalledTimes(2);
});
