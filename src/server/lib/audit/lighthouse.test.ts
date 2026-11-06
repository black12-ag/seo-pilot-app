import { describe, expect, it, vi } from "vitest";

const {
  createDataforseoClientMock,
  hasDataforseoAccess,
  fetchPageSpeedReport,
} = vi.hoisted(() => ({
  createDataforseoClientMock: vi.fn(),
  hasDataforseoAccess: vi.fn(async () => true),
  fetchPageSpeedReport: vi.fn(),
}));

vi.mock("@/server/lib/dataforseo", () => ({
  createDataforseoClient: createDataforseoClientMock,
}));

vi.mock("@/server/lib/provider-access", () => ({ hasDataforseoAccess }));

vi.mock("./pageSpeedInsights", () => ({ fetchPageSpeedReport }));

vi.mock("@/server/lib/r2", () => ({
  putTextToR2: vi.fn(),
}));

import { fetchLighthouseResult, selectLighthouseSample } from "./lighthouse";

const okPage = (url: string) => ({
  url,
  statusCode: 200,
  fetchClass: "ok" as const,
});

describe("selectLighthouseSample", () => {
  it("does not spend checks on a bot challenge that answered 200", () => {
    const selected = selectLighthouseSample(
      [
        { ...okPage("https://example.com/"), fetchClass: "blocked" },
        okPage("https://example.com/about"),
      ],
      "https://example.com/",
      "auto",
    );

    expect(selected).toEqual(["https://example.com/about"]);
  });

  it("includes a start page reached through a trailing-slash redirect", () => {
    const pages = [
      ...Array.from({ length: 10 }, (_, index) =>
        okPage(`https://example.com/section${index}`),
      ),
      okPage("https://example.com/services/"),
    ];

    const selected = selectLighthouseSample(
      pages,
      "https://example.com/services",
      "auto",
    );

    expect(selected).toHaveLength(10);
    expect(selected[0]).toBe("https://example.com/services/");
  });

  it("prefers an exact start page when both slash forms return 2xx", () => {
    const selected = selectLighthouseSample(
      [
        okPage("https://example.com/services/"),
        okPage("https://example.com/services"),
      ],
      "https://example.com/services",
      "auto",
    );

    expect(selected[0]).toBe("https://example.com/services");
  });

  it("does not sample another page from the start page's template", () => {
    const selected = selectLighthouseSample(
      [
        okPage("https://example.com/products/123"),
        okPage("https://example.com/products/456"),
        okPage("https://example.com/about"),
      ],
      "https://example.com/products/123",
      "auto",
    );

    expect(selected).toEqual([
      "https://example.com/products/123",
      "https://example.com/about",
    ]);
  });
});

describe("fetchLighthouseResult", () => {
  const billingCustomer = {
    userId: "user-1",
    userEmail: "test@example.com",
    organizationId: "org-1",
  };

  it("does not retry an ambiguous generic failure", async () => {
    const live = vi
      .fn()
      .mockRejectedValueOnce(new Error("temporary failure"))
      .mockResolvedValueOnce({
        scores: {
          performance: 90,
          accessibility: 91,
          "best-practices": 92,
          seo: 93,
        },
        metrics: {
          largestContentfulPaint: { numericValue: 1000 },
          cumulativeLayoutShift: { numericValue: 0.01 },
          interactionToNextPaint: { numericValue: 100 },
          serverResponseTime: { numericValue: 200 },
        },
      });
    createDataforseoClientMock.mockReturnValue({
      lighthouse: { live },
    });

    const fetched = await fetchLighthouseResult(
      "https://example.com/",
      "page-1",
      "desktop",
      billingCustomer,
    );

    expect(live).toHaveBeenCalledOnce();
    expect(fetched.result.errorMessage).toBe("temporary failure");
  });

  it("uses Google's API and never DataForSEO with no key", async () => {
    hasDataforseoAccess.mockResolvedValueOnce(false);
    fetchPageSpeedReport.mockResolvedValue({
      scores: {
        performance: 82,
        accessibility: 90,
        "best-practices": 100,
        seo: 93,
      },
      metrics: {
        largestContentfulPaint: { numericValue: 2900 },
        cumulativeLayoutShift: { numericValue: 0.02 },
        interactionToNextPaint: { numericValue: null },
        serverResponseTime: { numericValue: 180 },
      },
    });

    const fetched = await fetchLighthouseResult(
      "https://example.com/",
      "page-1",
      "mobile",
      billingCustomer,
    );

    expect(createDataforseoClientMock).not.toHaveBeenCalled();
    expect(fetchPageSpeedReport).toHaveBeenCalledWith({
      url: "https://example.com/",
      strategy: "mobile",
    });
    expect(fetched.result).toMatchObject({
      performanceScore: 82,
      lcpMs: 2900,
      inpMs: null,
      ttfbMs: 180,
    });
    expect(fetched.payloadJson).toContain("scores");
  });

  it("records Google's refusal on the check, so the audit carries on", async () => {
    hasDataforseoAccess.mockResolvedValueOnce(false);
    fetchPageSpeedReport.mockRejectedValue(
      new Error("Set PAGESPEED_API_KEY to your own free key."),
    );

    const fetched = await fetchLighthouseResult(
      "https://example.com/",
      "page-1",
      "mobile",
      billingCustomer,
    );

    expect(fetched.result.errorMessage).toContain("PAGESPEED_API_KEY");
    expect(fetched.result.performanceScore).toBeNull();
    expect(fetched.payloadJson).toBeNull();
  });
});
