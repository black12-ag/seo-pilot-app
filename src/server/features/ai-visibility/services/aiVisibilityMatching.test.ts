import { describe, expect, it } from "vitest";
import type { ParsedAiAnswer } from "../providers/dataforseoEvidence";
import {
  aiMentionSpans,
  aiPromptIsBranded,
  matchAiBrand,
  ownedAiDomain,
} from "./aiVisibilityMatching";

const brand = { name: "SEO Pilot", domain: "seo.viral4all.com" };
function answer(text: string, citedHosts: string[] = []): ParsedAiAnswer {
  return {
    answerMarkdown: text,
    answerText: text,
    citations: citedHosts.map((domain, index) => ({
      url: `https://${domain}/guide`,
      domain,
      title: null,
      position: index + 1,
    })),
    collectedAt: null,
  };
}

describe("brand mentions", () => {
  it.each([
    ["SEO Pilot is an open-source toolkit.", 0],
    ["SEO Pilot's MCP supports research.", 0],
    ["Try seo.viral4all.com for audits.", 4],
    ["SEO Pilotsomething and MySEO Pilot are different names.", null],
    [
      "Links: https://seo.viral4all.com/SEO Pilot and www.seo.viral4all.com/SEO Pilot",
      null,
    ],
    ["Email SEO Pilot@example.com or help@seo.viral4all.com.", null],
    ["An unrelated toolkit has similar features.", null],
  ])("%s", (text, firstMention) => {
    expect(matchAiBrand(answer(text), brand)).toMatchObject({
      mentioned: firstMention !== null,
      firstMention,
    });
  });

  it.each([
    ["acmeride.com", true],
    ["shop.acmeride.com", false],
  ])("bare name mentions a brand named %s: %s", (domain, mentioned) => {
    const text = "- [Acmeride](https://www.acmeride.com/): Connects directly.";
    expect(matchAiBrand(answer(text), { name: domain, domain }).mentioned).toBe(
      mentioned,
    );
  });

  it("returns original UTF-16 offsets through emoji and both Unicode accent forms", () => {
    const text = "🔎 Café and Café are the same spelling.";
    const spans = aiMentionSpans(text, ["Café"]);
    expect(spans.map((span) => text.slice(span.start, span.end))).toEqual([
      "Café",
      "Café",
    ]);
    expect(spans[0]).toEqual({ start: 3, end: 7 });
  });

  it("escapes regex syntax and keeps the longest overlapping name", () => {
    const text = "C++ Tools and Open SEO Tools";
    expect(
      aiMentionSpans(text, ["C++ Tools", "Open SEO", "Open SEO Tools"]).map(
        (s) => text.slice(s.start, s.end),
      ),
    ).toEqual(["C++ Tools", "Open SEO Tools"]);
  });
});

describe("brand citations", () => {
  it.each([
    "seo.viral4all.com",
    "www.seo.viral4all.com",
    "docs.seo.viral4all.com",
  ])("counts a cited page on %s", (host) => {
    expect(matchAiBrand(answer("Other tools.", [host]), brand)).toMatchObject({
      mentioned: false,
      cited: true,
    });
  });
  it.each([
    "seo.viral4all.com.evil.example",
    "notseo.viral4all.com",
    "seopilot.com",
  ])("does not count %s", (host) => {
    expect(ownedAiDomain(host, brand.domain)).toBe(false);
    expect(matchAiBrand(answer("Other tools.", [host]), brand).cited).toBe(
      false,
    );
  });
});

describe("branded prompt cohort", () => {
  it.each([
    "What is SEO Pilot?",
    "Review https://seo.viral4all.com",
    "What does www.seo.viral4all.com offer?",
    "Review docs.seo.viral4all.com/mcp",
  ])("includes %s", (prompt) => {
    expect(aiPromptIsBranded(prompt, brand)).toBe(true);
  });
  it.each([
    "Best open source SEO tools?",
    "Review https://seo.viral4all.com.evil.example",
    "Review https://notseo.viral4all.com",
  ])("excludes %s", (prompt) => {
    expect(aiPromptIsBranded(prompt, brand)).toBe(false);
  });
});
