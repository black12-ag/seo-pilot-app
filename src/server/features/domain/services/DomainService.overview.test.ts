import { beforeEach, expect, it, vi } from "vitest";
import { DomainService } from "./DomainService";

const rankOverview = vi.fn();
const cache = new Map<string, unknown>();
const setCached = vi.fn(async (key: string, value: unknown, _ttl: number) => {
  cache.set(key, value);
});

vi.mock("cloudflare:workers", () => ({
  waitUntil: (promise: Promise<unknown>) => void promise,
}));
vi.mock("@/server/lib/r2-cache", () => ({
  buildCacheKey: async (prefix: string, params: Record<string, unknown>) =>
    `${prefix}:${JSON.stringify(params)}`,
  getCached: async (key: string) => cache.get(key) ?? null,
  setCached: (...args: [string, unknown, number]) => setCached(...args),
}));
vi.mock("@/server/lib/dataforseo", () => ({
  createDataforseoClient: () => ({ domain: { rankOverview } }),
}));

const input = {
  projectId: "project-1",
  domain: "example.com",
  locationCode: 2840,
  languageCode: "en",
};
const customer = {
  organizationId: "org-1",
  userId: "user-1",
  userEmail: "user@example.com",
};

beforeEach(() => {
  cache.clear();
  rankOverview.mockResolvedValue([]);
});

it.each([
  { response: [], traffic: null, keywords: null },
  {
    response: [{ metrics: { organic: { etv: 0, count: 0 } } }],
    traffic: 0,
    keywords: 0,
  },
])(
  "reuses successful empty overview data",
  async ({ response, traffic, keywords }) => {
    rankOverview.mockResolvedValue(response);
    const first = await DomainService.getOverview(input, customer);
    const second = await DomainService.getOverview(input, customer);

    expect(first).toMatchObject({
      organicTraffic: traffic,
      organicKeywords: keywords,
      backlinks: null,
      referringDomains: null,
      hasData: false,
    });
    expect(second).toEqual(first);
    expect(rankOverview).toHaveBeenCalledOnce();
    expect(setCached).toHaveBeenCalledOnce();
    expect(setCached).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ fetchedAt: first.fetchedAt }),
      43200,
    );
  },
);

it("propagates provider failure without caching an empty result", async () => {
  const error = new Error("provider authentication failed");
  rankOverview.mockRejectedValue(error);

  await expect(DomainService.getOverview(input, customer)).rejects.toBe(error);
  expect(setCached).not.toHaveBeenCalled();
  expect(cache.size).toBe(0);
});
