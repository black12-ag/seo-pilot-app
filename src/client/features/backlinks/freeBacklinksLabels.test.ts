import { describe, expect, it } from "vitest";
import { crawlPeriodLabel, shortDate } from "./freeBacklinksLabels";

describe("crawlPeriodLabel", () => {
  it.each([
    ["cc-main-2026-aug-sep-oct", "Aug–Oct 2026"],
    ["cc-main-2025-26-dec-jan-feb", "Dec 2025–Feb 2026"],
    ["cc-main-2018-jan", "Jan 2018"],
    ["something-else", null],
  ])("reads %s", (release, label) => {
    expect(crawlPeriodLabel(release)).toBe(label);
  });
});

describe("shortDate", () => {
  it("shows the UTC day", () => {
    expect(shortDate("2026-10-22T23:30:00.000Z")).toBe("22 Oct 2026");
  });
});
