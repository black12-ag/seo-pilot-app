import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { getOptionalEnvValue } = vi.hoisted(() => ({
  getOptionalEnvValue: vi.fn(),
}));
vi.mock("@/server/lib/runtime-env", () => ({ getOptionalEnvValue }));

import { fetchPageSpeedReport } from "./pageSpeedInsights";

// The shape in Google's reference: a Lighthouse report under lighthouseResult.
const report = {
  kind: "pagespeedonline#result",
  lighthouseResult: {
    requestedUrl: "https://example.com/",
    finalUrl: "https://www.example.com/",
    lighthouseVersion: "12.0.0",
    runtimeError: { code: "NO_ERROR", message: "" },
    categories: {
      performance: { score: 0.82, auditRefs: [{ id: "render-blocking" }] },
      accessibility: { score: 0.9, auditRefs: [] },
      "best-practices": { score: 1, auditRefs: [] },
      seo: { score: null, auditRefs: [] },
    },
    audits: {
      "largest-contentful-paint": {
        score: 0.7,
        displayValue: "2.9 s",
        numericValue: 2900,
      },
      "cumulative-layout-shift": { score: 1, numericValue: 0.02 },
      "server-response-time": { score: 1, numericValue: 180 },
      "render-blocking": {
        title: "Eliminate render-blocking resources",
        description: "Resources are blocking the first paint.",
        score: 0.3,
        scoreDisplayMode: "metricSavings",
        displayValue: "Est savings of 300 ms",
        details: { overallSavingsMs: 300, items: [] },
      },
    },
  },
};

const pageSpeedResponse = vi.fn<() => Response>();
const requests: Request[] = [];

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status });
}

beforeEach(() => {
  requests.length = 0;
  getOptionalEnvValue.mockResolvedValue(undefined);
  pageSpeedResponse.mockReturnValue(json(report));
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string, init?: RequestInit) => {
      // The URL policy's public DNS lookup comes through here too.
      if (!input.startsWith("https://www.googleapis.com/"))
        return json({ Status: 0, Answer: [] });
      requests.push(new Request(input, init));
      return pageSpeedResponse();
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const fetchReport = () =>
  fetchPageSpeedReport({ url: "https://example.com/", strategy: "mobile" });

describe("fetchPageSpeedReport", () => {
  it("asks for all four categories and maps the report", async () => {
    const stored = await fetchReport();

    const url = new URL(requests[0].url);
    expect(url.searchParams.get("url")).toBe("https://example.com/");
    expect(url.searchParams.get("strategy")).toBe("mobile");
    expect(url.searchParams.getAll("category")).toEqual([
      "performance",
      "accessibility",
      "best-practices",
      "seo",
    ]);
    expect(stored).toMatchObject({
      source: "pagespeed-insights",
      metadata: {
        finalUrl: "https://www.example.com/",
        strategy: "mobile",
        lighthouseVersion: "12.0.0",
        cost: null,
      },
      scores: {
        performance: 82,
        accessibility: 90,
        "best-practices": 100,
        seo: null,
      },
    });
    expect(stored.metrics.largestContentfulPaint.numericValue).toBe(2900);
    expect(stored.metrics.serverResponseTime.numericValue).toBe(180);
    expect(stored.issues.map((issue) => issue.auditKey)).toEqual([
      "render-blocking",
    ]);
  });

  it("reports no interaction time, which a lab run can't measure", async () => {
    const stored = await fetchReport();
    expect(stored.metrics.interactionToNextPaint.numericValue).toBeNull();
  });

  it("sends the key in a header, never in the URL", async () => {
    getOptionalEnvValue.mockResolvedValue("secret-key");
    await fetchReport();
    expect(requests[0].headers.get("x-goog-api-key")).toBe("secret-key");
    expect(requests[0].url).not.toContain("secret-key");
  });

  it.each([
    "http://localhost/",
    "http://127.0.0.1/admin",
    "http://169.254.169.254/latest/meta-data/",
    "http://10.0.0.5/",
  ])("never sends %s to Google", async (url) => {
    await expect(
      fetchPageSpeedReport({ url, strategy: "mobile" }),
    ).rejects.toMatchObject({ code: "CRAWL_TARGET_BLOCKED" });
    expect(requests).toHaveLength(0);
  });

  it("explains the quota refusal Google gives without a key", async () => {
    pageSpeedResponse.mockReturnValue(
      json(
        {
          error: {
            code: 429,
            message:
              "Quota exceeded for quota metric 'Queries' and limit 'Queries per day' for consumer 'project_number:1'.",
          },
        },
        429,
      ),
    );
    const failure = fetchReport();
    await expect(failure).rejects.toThrow("Set PAGESPEED_API_KEY");
    await expect(failure).rejects.not.toThrow("project_number");
  });

  it("says when a key has reached its limit", async () => {
    getOptionalEnvValue.mockResolvedValue("secret-key");
    pageSpeedResponse.mockReturnValue(json({ error: {} }, 429));
    await expect(fetchReport()).rejects.toThrow("limit reached");
  });

  it("names a rejected key without repeating it", async () => {
    getOptionalEnvValue.mockResolvedValue("secret-key");
    pageSpeedResponse.mockReturnValue(
      json({ error: { message: "API key not valid: secret-key" } }, 400),
    );
    const failure = fetchReport();
    await expect(failure).rejects.toThrow("Google rejected PAGESPEED_API_KEY");
    await expect(failure).rejects.not.toThrow("secret-key");
  });

  it("reports a page Lighthouse couldn't load, from an API error", async () => {
    pageSpeedResponse.mockReturnValue(
      json({ error: { message: "Lighthouse returned error: NO_FCP." } }, 500),
    );
    await expect(fetchReport()).rejects.toThrow(
      "Lighthouse encountered an error with the following code: NO_FCP",
    );
  });

  it("reports a page Lighthouse couldn't load, from the report", async () => {
    pageSpeedResponse.mockReturnValue(
      json({
        lighthouseResult: {
          ...report.lighthouseResult,
          runtimeError: { code: "ERRORED_DOCUMENT_REQUEST" },
        },
      }),
    );
    await expect(fetchReport()).rejects.toThrow(
      "with the following code: ERRORED_DOCUMENT_REQUEST",
    );
  });

  it("fails on a response with no scores rather than storing blanks", async () => {
    pageSpeedResponse.mockReturnValue(
      json({
        lighthouseResult: { ...report.lighthouseResult, categories: {} },
      }),
    );
    await expect(fetchReport()).rejects.toThrow("no category scores");
  });

  it("fails on a response with no report", async () => {
    pageSpeedResponse.mockReturnValue(json({ kind: "pagespeedonline#result" }));
    await expect(fetchReport()).rejects.toThrow("no Lighthouse report");
  });
});
