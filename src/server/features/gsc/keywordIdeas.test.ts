import { beforeEach, describe, expect, it, vi } from "vitest";
import { getGscKeywordIdeas } from "./keywordIdeas";

const mocks = vi.hoisted(() => ({ getPerformance: vi.fn() }));

vi.mock("@/server/features/gsc/services/GscService", () => ({
  GscService: { getPerformance: mocks.getPerformance },
}));

describe("getGscKeywordIdeas", () => {
  beforeEach(() => {
    mocks.getPerformance.mockImplementation((input: { dimensions: string[] }) =>
      Promise.resolve({
        rows:
          input.dimensions.length === 1
            ? [
                {
                  keys: ["top query"],
                  clicks: 9,
                  impressions: 100,
                  ctr: 0.09,
                  position: 2.04,
                },
                {
                  keys: ["near query"],
                  clicks: 1,
                  impressions: 300,
                  ctr: 0.0033,
                  position: 11.46,
                },
              ]
            : [
                {
                  keys: ["near query", "https://own.example/b"],
                  clicks: 0,
                  impressions: 10,
                  ctr: 0,
                  position: 30,
                },
                {
                  keys: ["near query", "https://own.example/a"],
                  clicks: 1,
                  impressions: 290,
                  ctr: 0,
                  position: 11,
                },
              ],
      }),
    );
  });

  it("lists the site's queries as impressions with the best page and striking distance", async () => {
    const result = await getGscKeywordIdeas({
      projectId: "project_1",
      dateRange: "last_28_days",
      device: "MOBILE",
      country: "usa",
    });

    expect(result.ideas).toEqual([
      {
        keyword: "near query",
        clicks: 1,
        impressions: 300,
        ctr: 0.0033,
        position: 11.5,
        page: "https://own.example/a",
        strikingDistance: true,
      },
      {
        keyword: "top query",
        clicks: 9,
        impressions: 100,
        ctr: 0.09,
        position: 2,
        page: null,
        strikingDistance: false,
      },
    ]);
    expect(mocks.getPerformance).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: "project_1",
        filters: [
          { dimension: "device", operator: "equals", expression: "MOBILE" },
          { dimension: "country", operator: "equals", expression: "usa" },
        ],
      }),
    );
  });
});
