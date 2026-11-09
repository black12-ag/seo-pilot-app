import { describe, expect, it } from "vitest";
import { dataforseoPageFor } from "./dataforseoPages";

describe("dataforseoPageFor", () => {
  it.each([
    "/p/abc/keyword-gap",
    "/p/abc/domain",
    "/p/abc/ai-visibility",
    "/p/abc/ai-visibility/research",
    "/p/abc/ai-visibility/sources",
    "/p/abc/prompt-explorer",
    "/p/abc/local-seo",
    "/p/$projectId/domain",
  ])("gates %s", (path) => {
    expect(dataforseoPageFor(path)).not.toBeNull();
  });

  it.each([
    "/p/abc",
    "/p/abc/opportunities",
    "/p/abc/backlinks",
    "/p/abc/keywords",
    "/p/$projectId/keywords",
    "/p/abc/rank-tracking",
    "/p/abc/rank-tracking/some-config",
    "/p/abc/keyword-clusters",
    "/p/abc/saved",
    "/p/abc/search-performance",
    "/p/abc/audit",
    "/p/abc/sam",
    "/p/abc/content",
    "/p/abc/publishing",
    "/p/abc/reports",
    "/p/abc/context",
    "/p/abc/settings",
    "/p/abc/constructor",
    "/ai",
    "/settings",
  ])("leaves %s free", (path) => {
    expect(dataforseoPageFor(path)).toBeNull();
  });
});
