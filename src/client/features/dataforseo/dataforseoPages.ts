export const DATAFORSEO_OPTIONAL_LABEL = "Optional: needs a DataForSEO key";

// The pages that can't do anything with no DataForSEO key, by the path segment
// after /p/<project>. Everything under them is gated, and the sidebar marks them.
// Backlinks isn't here: with no key it shows free Common Crawl data.
const DATAFORSEO_PAGES: Record<string, { title: string; gives: string }> = {
  keywords: {
    title: "Keyword Research",
    gives: "search volume, difficulty and related keyword ideas",
  },
  "keyword-gap": {
    title: "Keyword Gap",
    gives: "the keywords competitors rank for that you don't",
  },
  domain: {
    title: "Domain Overview",
    gives: "any site's traffic, top keywords and pages",
  },
  "ai-visibility": {
    title: "AI Visibility",
    gives: "what AI engines answer for your prompts, and who they cite",
  },
  "prompt-explorer": {
    title: "Prompt Explorer",
    gives: "AI answers and sources for any prompt",
  },
  "brand-lookup": {
    title: "Brand Lookup",
    gives: "how AI engines describe a brand",
  },
  "rank-tracking": {
    title: "Rank Tracking",
    gives: "your keyword positions over time",
  },
  "local-seo": {
    title: "Local SEO",
    gives: "your Google Maps rankings across an area",
  },
};

/** The page's entry for a path such as /p/abc/keywords or /p/$projectId/domain. */
export function dataforseoPageFor(path: string) {
  const segment = /^\/p\/[^/]+\/([^/]+)/.exec(path)?.[1];
  return segment && Object.hasOwn(DATAFORSEO_PAGES, segment)
    ? DATAFORSEO_PAGES[segment]
    : null;
}
