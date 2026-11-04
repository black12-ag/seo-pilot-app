import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { KeywordClusterCard } from "./KeywordClusterCard";

function render(
  keywords: Array<{
    keyword: string;
    searchVolume: number | null;
    intent: string | null;
    tracked: boolean;
  }>,
) {
  return renderToStaticMarkup(
    createElement(KeywordClusterCard, {
      cluster: {
        id: "seo tools",
        label: "seo tools",
        keywords,
        trackedKeywords: [],
        pages: [],
      },
      onRemove: vi.fn(),
    }),
  );
}

it("shows unknown metrics as unknown, not zero", () => {
  const html = render([
    { keyword: "seo tools", searchVolume: null, intent: null, tracked: false },
  ]);
  expect(html).toContain("Volume unknown");
  expect(html).toContain("Unknown. No intent data yet.");
  expect(html).not.toMatch(/>0</);
});

it("says how much of a total is known and suggests a page from intent", () => {
  const html = render([
    {
      keyword: "seo tools",
      searchVolume: 1200,
      intent: "commercial",
      tracked: true,
    },
    {
      keyword: "free seo tools",
      searchVolume: null,
      intent: null,
      tracked: false,
    },
  ]);
  expect(html).toContain("1,200 searches a month (known for 1 of 2)");
  expect(html).toContain("Comparison or best-of page");
  expect(html).toContain("Tracked");
  expect(html).toContain("Remove free seo tools from this view");
});
