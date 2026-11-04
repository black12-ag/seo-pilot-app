import { expect, it } from "vitest";
import {
  verifiedWebsiteCandidates,
  withoutResearchReferences,
} from "./websiteResearchEvidence";
import type { WebsiteResearch } from "@/types/schemas/projectWebsite";

const review: WebsiteResearch = {
  name: "Example",
  domain: "example.com",
  overview: "SEO tools",
  competitors: [
    {
      name: "Rival",
      domain: "rival.com",
      notes: "Observed competition ".repeat(20),
      sourceUrl: "https://rival.com/about",
    },
  ],
  preserveCompetitors: false,
  suggestedTopics: [],
  suggestedKeywords: [],
};

it("keeps only nonempty exact final-read evidence with bounded rationale and bytes", async () => {
  const pages = new Map([
    [
      "https://rival.com/about",
      {
        url: "https://rival.com/about",
        title: "Rival",
        text: "🙂".repeat(1000),
        capturedAtMs: 1000,
      },
    ],
  ]);
  const [candidate] = await verifiedWebsiteCandidates(review, pages);
  expect(candidate).toMatchObject({
    domain: "rival.com",
    extractionMethod: "legacy_read_site",
    source: { url: "https://rival.com/about", capturedAtMs: 1000 },
  });
  expect(candidate.notes.length).toBe(180);
  expect(
    new TextEncoder().encode(candidate.source.excerpt).byteLength,
  ).toBeLessThanOrEqual(2000);
  expect(await verifiedWebsiteCandidates(review, new Map())).toEqual([]);
  expect(
    await verifiedWebsiteCandidates(
      review,
      new Map([
        [
          "https://rival.com/about",
          {
            ...pages.get("https://rival.com/about")!,
            url: "https://foreign.com/",
          },
        ],
      ]),
    ),
  ).toEqual([]);
  expect(
    await verifiedWebsiteCandidates(
      review,
      new Map([
        [
          "https://rival.com/about",
          { ...pages.get("https://rival.com/about")!, text: " " },
        ],
      ]),
    ),
  ).toEqual([]);
});

it("removes unpersisted model or legacy Workflow reference IDs", () => {
  const unsafe = {
    ...review,
    websiteResearchAttemptId: crypto.randomUUID(),
    competitorResearchRunId: crypto.randomUUID(),
    competitorResearchContextVersion: 1,
    competitors: [
      { ...review.competitors[0], researchCandidateId: crypto.randomUUID() },
    ],
  };
  const safe = withoutResearchReferences(unsafe);
  expect(safe.competitors[0]).toEqual(review.competitors[0]);
  expect(JSON.stringify(safe)).not.toMatch(
    /ResearchAttemptId|ResearchRunId|researchCandidateId|ResearchContextVersion/,
  );
});
