import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { KeywordGapService } from "./KeywordGapService";
import { customer, project, stubProvider } from "./keywordGapTestProvider";

const mocks = vi.hoisted(() => ({
  hasAccess: vi.fn<() => Promise<boolean>>(),
  hosted: vi.fn<() => Promise<boolean>>(),
  reserve: vi.fn(),
  settle: vi.fn(),
  setCached: vi.fn(async () => undefined),
  listCompetitors: vi.fn(),
}));

vi.mock("cloudflare:workers", () => ({
  waitUntil: (promise: Promise<unknown>) => void promise,
}));
vi.mock("@/server/lib/r2-cache", () => ({
  buildCacheKey: async (prefix: string) => prefix,
  getCached: async () => null,
  setCached: mocks.setCached,
}));
vi.mock("@/server/lib/provider-access", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  hasDataforseoAccess: mocks.hasAccess,
}));
vi.mock("@/server/lib/runtime-env", () => ({
  getOptionalEnvValue: vi.fn(async () => undefined),
  getRequiredEnvValue: vi.fn(async () => "test-api-key"),
  isHostedServerAuthMode: mocks.hosted,
}));
vi.mock("@/server/billing/subscription", () => ({
  getOrCreateOrganizationCustomer: async () => ({ id: "customer" }),
  reserveUsageCredits: mocks.reserve,
  settleUsageCredits: mocks.settle,
}));
vi.mock(
  "@/server/features/project-context/repositories/ProjectContextRepository",
  () => ({
    ProjectContextRepository: { listCompetitors: mocks.listCompetitors },
  }),
);

beforeEach(() => {
  mocks.hasAccess.mockResolvedValue(true);
  mocks.hosted.mockResolvedValue(false);
  mocks.listCompetitors.mockResolvedValue([]);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

it("meters each fetched domain on hosted installs", async () => {
  mocks.hosted.mockResolvedValue(true);
  mocks.reserve.mockResolvedValue({
    holds: [{ callIndexes: [0] }],
    refusedCalls: [],
  });
  mocks.settle.mockResolvedValue(undefined);
  stubProvider({
    "example.com": { items: [] },
    "rival.com": { items: [] },
  });

  const setup = await KeywordGapService.getSetup(project);
  expect(setup.estimate.usdPerDomain).toBeNull();
  await KeywordGapService.run(
    { project, competitors: ["rival.com"] },
    customer,
  );

  expect(mocks.reserve).toHaveBeenCalledTimes(2);
  expect(mocks.reserve).toHaveBeenCalledWith(
    expect.objectContaining({
      callCredits: [setup.estimate.creditsPerDomain],
    }),
  );
  expect(mocks.settle).toHaveBeenCalledTimes(2);
});

it("stops with the credit error when credits run out", async () => {
  mocks.hosted.mockResolvedValue(true);
  mocks.reserve.mockResolvedValue({ holds: [], refusedCalls: [0] });
  const fetchMock = stubProvider({
    "example.com": { items: [] },
    "rival.com": { items: [] },
  });

  await expect(
    KeywordGapService.run({ project, competitors: ["rival.com"] }, customer),
  ).rejects.toMatchObject({ code: "INSUFFICIENT_CREDITS" });
  expect(fetchMock).not.toHaveBeenCalled();
  expect(mocks.setCached).not.toHaveBeenCalled();
});

it("lists saved competitors, the market used and the setup state", async () => {
  mocks.listCompetitors.mockResolvedValue([
    { domain: "rival.com", name: "Rival", notes: "private" },
  ]);
  mocks.hasAccess.mockResolvedValue(false);

  const setup = await KeywordGapService.getSetup(project);

  expect(setup).toMatchObject({
    providerConfigured: false,
    projectDomain: "example.com",
    market: { locationCode: 2826, languageCode: "en" },
    isProjectMarket: true,
    competitors: [{ domain: "rival.com", name: "Rival" }],
    estimate: { hosted: false, rowsPerDomain: 500 },
  });
  expect(setup.estimate.usdPerDomain).toBeGreaterThan(0);
  expect(mocks.listCompetitors).toHaveBeenCalledWith("project-1");
});
