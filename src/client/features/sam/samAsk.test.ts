import { describe, expect, it } from "vitest";
import { SAM_ASK_MAX_LENGTH, samAskText, samSearchSchema } from "./samAsk";

describe("SAM ask link", () => {
  it("keeps a normal question and the session id", () => {
    expect(
      samSearchSchema.parse({ s: "chat_1", ask: "  How do I fix this?  " }),
    ).toEqual({ s: "chat_1", ask: "How do I fix this?" });
  });

  it("drops a question that is empty, not text, or over the limit instead of cutting it", () => {
    for (const ask of [
      "   ",
      42,
      ["a", "b"],
      "x".repeat(SAM_ASK_MAX_LENGTH + 1),
    ]) {
      expect(samSearchSchema.parse({ ask })).toEqual({ ask: undefined });
    }
    expect(
      samSearchSchema.parse({ ask: "x".repeat(SAM_ASK_MAX_LENGTH) }).ask,
    ).toHaveLength(SAM_ASK_MAX_LENGTH);
  });

  it("strips control and bidi-override characters but keeps line breaks", () => {
    const hidden = `fix${String.fromCharCode(0x202e)}this${String.fromCharCode(0)}\nnow`;
    expect(samSearchSchema.parse({ ask: hidden }).ask).toBe("fixthis\nnow");
  });

  it("cuts long in-app item text to a question the link accepts", () => {
    const long = samAskText(`Fix ${"https://example.com/page ".repeat(80)}`);
    expect(long.length).toBeLessThanOrEqual(SAM_ASK_MAX_LENGTH);
    expect(long.endsWith("…")).toBe(true);
    expect(samSearchSchema.parse({ ask: long }).ask).toBe(long);
  });

  it("never leaves half of an emoji at the cut", () => {
    const text = `${"x".repeat(SAM_ASK_MAX_LENGTH - 2)}😀😀`;
    const cut = samAskText(text);
    expect(cut).toBe(`${"x".repeat(SAM_ASK_MAX_LENGTH - 2)}…`);
  });
});
