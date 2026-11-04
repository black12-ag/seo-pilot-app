import { describe, expect, it } from "vitest";
import { runPageReporters } from "@/server/lib/audit/issues/page-reporters";
import {
  findSitemapIssues,
  type SlimPage,
} from "@/server/lib/audit/issues/multipage-checks";
import type { CrawledPageResult, PageLink } from "@/server/lib/audit/types";

const HEALTHY_LINK: PageLink = {
  targetUrl: "https://example.com/catalog",
  anchor: "Catalog",
  isInternal: true,
  isNofollow: false,
};

function makePage(overrides: Partial<CrawledPageResult>): CrawledPageResult {
  return {
    id: "page-1",
    url: "https://example.com/a",
    statusCode: 200,
    fetchClass: "ok",
    redirectUrl: null,
    title: "A perfectly reasonable page title",
    metaDescription:
      "A reasonable meta description that says something useful about the page.",
    canonicalUrl: null,
    robotsMeta: null,
    xRobotsTag: null,
    headerCanonicalUrl: null,
    ogTitle: "Social title",
    ogDescription: "Social description",
    ogImage: "https://example.com/og.png",
    h1Count: 1,
    h2Count: 0,
    h3Count: 0,
    h4Count: 0,
    h5Count: 0,
    h6Count: 0,
    headingOrder: [1, 2, 3],
    wordCount: 500,
    contentHash: "abc123",
    isHtml: true,
    htmlBytes: 10_000,
    rateLimited: false,
    imagesTotal: 0,
    imagesMissingAlt: 0,
    images: [],
    links: [HEALTHY_LINK],
    hasStructuredData: true,
    hreflangTags: [],
    isIndexable: true,
    responseTimeMs: 200,
    crawlDepth: 1,
    inSitemap: true,
    ...overrides,
  };
}

function issueTypes(page: CrawledPageResult): string[] {
  return runPageReporters(page).map((issue) => issue.issueType);
}

function slim(overrides: Partial<SlimPage>): SlimPage {
  return {
    id: "p",
    url: "https://example.com/p",
    statusCode: 200,
    fetchClass: "ok",
    title: "t",
    metaDescription: "d",
    contentHash: "h",
    redirectUrl: null,
    wordCount: 300,
    isIndexable: true,
    canonicalUrl: null,
    headerCanonicalUrl: null,
    inSitemap: true,
    crawlDepth: 1,
    isHtml: true,
    ...overrides,
  };
}

describe("runPageReporters: structured data, social, https, hreflang, answers", () => {
  it("reports missing and unparsable structured data", () => {
    expect(issueTypes(makePage({ hasStructuredData: false }))).toEqual([
      "missing-structured-data",
    ]);
    expect(issueTypes(makePage({ jsonLdInvalid: 1 }))).toEqual([
      "invalid-structured-data",
    ]);
  });

  it("lists which social tags are missing", () => {
    const issues = runPageReporters(makePage({ ogTitle: null, ogImage: " " }));
    expect(issues).toHaveLength(1);
    expect(issues[0].details).toEqual({ missing: ["og:title", "og:image"] });
  });

  it("flags HTTP pages and HTTPS pages linking to their own HTTP pages", () => {
    expect(issueTypes(makePage({ url: "http://example.com/a" }))).toEqual([
      "http-page",
    ]);
    const link = { ...HEALTHY_LINK, targetUrl: "http://example.com/old" };
    const other = { ...HEALTHY_LINK, targetUrl: "http://other.com/x" };
    expect(
      issueTypes(makePage({ links: [link, other, HEALTHY_LINK] })),
    ).toEqual(["https-links-to-http"]);
    expect(issueTypes(makePage({ links: [other, HEALTHY_LINK] }))).toEqual([]);
  });

  it("checks hreflang codes and self reference", () => {
    const self = { lang: "en", href: "https://example.com/a" };
    const fr = { lang: "fr-FR", href: "https://example.com/fr/a" };
    expect(issueTypes(makePage({ hreflangLinks: [self, fr] }))).toEqual([]);
    expect(
      issueTypes(
        makePage({
          hreflangLinks: [self, { lang: "x-default", href: self.href }],
        }),
      ),
    ).toEqual([]);
    expect(issueTypes(makePage({ hreflangLinks: [fr] }))).toEqual([
      "hreflang-missing-self",
    ]);
    expect(
      issueTypes(
        makePage({ hreflangLinks: [self, { lang: "english", href: null }] }),
      ),
    ).toEqual(["invalid-hreflang"]);
  });

  it("suggests answers and sources as info only", () => {
    const issues = runPageReporters(
      makePage({
        unansweredQuestionHeadings: ["What is it?"],
        wordCount: 1500,
        links: [HEALTHY_LINK],
      }),
    );
    expect(issues.map((i) => i.issueType)).toEqual([
      "question-heading-no-answer",
      "long-content-no-external-links",
    ]);
    const external = {
      ...HEALTHY_LINK,
      targetUrl: "https://other.com/",
      isInternal: false,
    };
    expect(
      issueTypes(makePage({ wordCount: 1500, links: [external] })),
    ).toEqual([]);
  });

  it("skips content-level checks on unread app shells", () => {
    expect(
      issueTypes(
        makePage({
          javascriptShell: true,
          hasStructuredData: false,
          ogTitle: null,
        }),
      ),
    ).toEqual(["javascript-rendering-suspected"]);
  });
});

describe("findSitemapIssues", () => {
  it("reports no sitemap once, on the home page", () => {
    const issues = findSitemapIssues([
      slim({ id: "a", url: "https://example.com/a", inSitemap: false }),
      slim({
        id: "home",
        url: "https://example.com/",
        inSitemap: false,
        crawlDepth: 0,
      }),
    ]);
    expect(issues.map((i) => [i.issueType, i.pageId])).toEqual([
      ["missing-sitemap", "home"],
    ]);
  });

  it("lists indexable crawled pages left out of an existing sitemap", () => {
    const issues = findSitemapIssues([
      slim({ id: "in" }),
      slim({ id: "out", inSitemap: false }),
      slim({ id: "noindex", inSitemap: false, isIndexable: false }),
      slim({ id: "pdf", inSitemap: false, isHtml: false }),
      slim({ id: "moved", inSitemap: false, statusCode: 301 }),
    ]);
    expect(issues.map((i) => [i.issueType, i.pageId])).toEqual([
      ["page-not-in-sitemap", "out"],
    ]);
  });
});
