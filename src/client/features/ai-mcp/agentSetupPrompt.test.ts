import { describe, expect, it } from "vitest";
import { getAgentSetupPrompt } from "./agentSetupPrompt";

describe("agent prompts", () => {
  it("targets the current instance and explains secure manual authentication", () => {
    const prompt = getAgentSetupPrompt("https://seo.example.com");
    expect(prompt).toContain("https://seo.example.com/mcp");
    expect(prompt).toContain("https://seo.example.com/settings");
    expect(prompt).toContain("https://seo.example.com/help/agent");
    expect(prompt).toContain("Authorization: Bearer");
    expect(prompt).not.toContain("seo.viral4all.com");
    expect(prompt).toContain("Do not claim success before verification");
  });
});
