import { describe, expect, it } from "vitest";
import {
  PromptRange,
  inPromptPeriod,
  promptPeriod,
  promptPeriodLabel,
  promptPeriodWindow,
} from "./PromptDateRange";

const custom = (start: string, end: string) => ({
  preset: PromptRange.Custom,
  start,
  end,
});

describe("prompt period window", () => {
  it("runs from the first local midnight to the one after the last day", () => {
    const period = custom("2026-10-01", "2026-10-31");

    const window = promptPeriodWindow(period);

    expect(window).toEqual({
      start: new Date(2026, 9, 1).toISOString(),
      end: new Date(2026, 10, 1).toISOString(),
    });
    // The query and the in-page filter agree on both edges.
    expect(inPromptPeriod(new Date(2026, 9, 1).toISOString(), period)).toBe(
      true,
    );
    expect(inPromptPeriod(new Date(2026, 10, 1).toISOString(), period)).toBe(
      false,
    );
  });

  it("is open for all history, which has no dates of its own", () => {
    const period = promptPeriod(PromptRange.All);

    expect(promptPeriodWindow(period)).toEqual({});
    expect(promptPeriodLabel(period)).toBeNull();
  });

  it("is withheld until a custom range is valid", () => {
    expect(promptPeriodWindow(custom("", "2026-10-31"))).toBeNull();
    expect(promptPeriodWindow(custom("2026-11-01", "2026-10-31"))).toBeNull();
  });
});
