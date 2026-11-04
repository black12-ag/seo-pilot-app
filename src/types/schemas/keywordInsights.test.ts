import { expect, it } from "vitest";
import { keywordGapRunInputSchema } from "./keywordInsights";

it("needs confirmation and 1 to 3 valid domains before any paid work", () => {
  const projectId = "11111111-1111-4111-8111-111111111111";
  const parse = (input: object) =>
    keywordGapRunInputSchema.safeParse({ projectId, ...input }).success;
  const confirmedPaidWork = true;

  expect(parse({ competitors: ["rival.com"] })).toBe(false);
  expect(parse({ competitors: ["rival.com"], confirmedPaidWork: false })).toBe(
    false,
  );
  expect(parse({ competitors: [], confirmedPaidWork })).toBe(false);
  expect(parse({ competitors: ["nope"], confirmedPaidWork })).toBe(false);
  expect(
    parse({
      competitors: ["a.com", "b.com", "c.com", "d.com"],
      confirmedPaidWork,
    }),
  ).toBe(false);
  expect(
    parse({ competitors: ["a.com", "b.com", "c.com"], confirmedPaidWork }),
  ).toBe(true);
});
