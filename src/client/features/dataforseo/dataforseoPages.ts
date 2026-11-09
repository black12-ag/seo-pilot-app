export const DATAFORSEO_OPTIONAL_LABEL = "Optional: needs a DataForSEO key";

/** A free page that covers part of what a gated page does. */
export type FreeAlternative =
  | "search-performance"
  | "rank-tracking"
  | "keywords"
  | "backlinks";

// The pages that can't do anything with no DataForSEO key, by the path segment
// after /p/<project>. Everything under them is gated, and the sidebar marks them.
// Free with no key, so not here: Backlinks (Common Crawl data), Keyword
// Research and Rank Tracking (the site's own Search Console data).
const DATAFORSEO_PAGES: Record<
  string,
  {
    title: string;
    gives: string;
    alternatives?: FreeAlternative[];
    /** The installation's own AI engine can run this page with no key. */
    ownAiEngine?: boolean;
  }
> = {
  "keyword-gap": {
    title: "Keyword Gap",
    gives: "the keywords competitors rank for that you don't",
    alternatives: ["keywords", "rank-tracking", "backlinks"],
  },
  domain: {
    title: "Domain Overview",
    gives: "any site's traffic, top keywords and pages",
    alternatives: ["search-performance", "keywords", "backlinks"],
  },
  "ai-visibility": {
    title: "AI Visibility",
    gives: "what AI engines answer for your prompts, and who they cite",
    ownAiEngine: true,
  },
  "prompt-explorer": {
    title: "Prompt Explorer",
    gives: "AI answers and sources for any prompt",
    ownAiEngine: true,
  },
  "brand-lookup": {
    title: "Brand Lookup",
    gives: "how AI engines describe a brand",
  },
  "local-seo": {
    title: "Local SEO",
    gives: "your Google Maps rankings across an area",
    alternatives: ["search-performance", "rank-tracking"],
  },
};

/**
 * The page's entry for a path such as /p/abc/keywords or /p/$projectId/domain,
 * or null when the page works here. With the own AI engine set up, AI
 * visibility pages work with no key.
 */
export function dataforseoPageFor(path: string, ownAiEngine = false) {
  const segment = /^\/p\/[^/]+\/([^/]+)/.exec(path)?.[1];
  if (!segment || !Object.hasOwn(DATAFORSEO_PAGES, segment)) return null;
  const page = DATAFORSEO_PAGES[segment];
  return ownAiEngine && page.ownAiEngine ? null : page;
}
