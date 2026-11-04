import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { KeywordGapResults } from "./KeywordGapResults";

type Result = Parameters<typeof KeywordGapResults>[0]["result"];

const fetchedAt = "2026-11-04T10:00:00.000Z";
const result: Result = {
  status: "ready",
  market: { locationCode: 2826, languageCode: "en" },
  isProjectMarket: true,
  project: {
    domain: "example.com",
    fetchedAt,
    fetchedRows: 500,
    totalCount: 3200,
    complete: false,
  },
  competitors: [
    {
      domain: "rival.com",
      fetchedAt,
      fetchedRows: 1,
      totalCount: 1,
      complete: true,
    },
  ],
  missing: [
    {
      keyword: "their term",
      searchVolume: null,
      keywordDifficulty: null,
      projectRanks: false,
      projectPosition: null,
      projectUrl: null,
      competitors: [
        { domain: "rival.com", ranks: true, position: 3, url: null },
      ],
    },
  ],
  shared: [],
};

it("labels the market and fetch, and keeps unknown values unknown", () => {
  const html = renderToStaticMarkup(
    createElement(KeywordGapResults, { result }),
  );
  expect(html).toContain("United Kingdom · English");
  expect(html).toContain(new Date(fetchedAt).toLocaleDateString());
  expect(html).toContain("500 of 3,200 ranking keywords");
  expect(html).toContain("Unknown");
  expect(html).toContain("Not found");
  expect(html).toContain("may still rank for example.com");
  expect(html).toContain("Competitors only (1)");
  expect(html).toContain("Shared (0)");
});
