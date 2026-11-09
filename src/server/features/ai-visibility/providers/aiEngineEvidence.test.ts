import { beforeEach, describe, expect, it, vi } from "vitest";
import { matchAiBrand } from "../services/aiVisibilityMatching";
import {
  askOwnAiEngine,
  parseAiEngineAnswer,
  resolveOwnAiEngine,
} from "./aiEngineEvidence";

const mocks = vi.hoisted(() => ({
  env: {} as Record<string, string>,
  route: vi.fn(),
  generateText:
    vi.fn<(options: { prompt: string; system: string }) => Promise<unknown>>(),
}));
vi.mock("@/server/lib/runtime-env", () => ({
  getWorkersEnv: async () => mocks.env,
  getEnvValueSync: (env: Record<string, string>, name: string) => env[name],
}));
vi.mock("@/server/lib/openrouter", () => ({
  DEFAULT_CHAT_AGENT_MODEL: "openai/default",
  resolveAiRoute: mocks.route,
  buildChatAgentModel: () => "model",
}));
vi.mock("ai", () => ({ generateText: mocks.generateText }));

beforeEach(() => {
  mocks.env = {};
  mocks.route.mockReset();
  mocks.generateText.mockReset();
});

describe("parseAiEngineAnswer", () => {
  it("takes the URLs the model wrote as sources, cleaned and de-duplicated", () => {
    const answer = parseAiEngineAnswer(
      [
        "1. **PilotAI** - see [Pricing](https://pilotai.so/pricing?utm_source=x&plan=pro#top).",
        "2. Ahrefs: https://ahrefs.com/blog/, and again https://ahrefs.com/blog/.",
        "3. [1](https://example.com/a) [example.com](https://example.com/b)",
        "Not a source: javascript:alert(1) or ftp://files.example.com",
      ].join("\n"),
    );
    expect(answer.citations.map(({ url, title }) => ({ url, title }))).toEqual([
      { url: "https://pilotai.so/pricing?plan=pro", title: "Pricing" },
      { url: "https://ahrefs.com/blog/", title: null },
      { url: "https://example.com/a", title: null },
      { url: "https://example.com/b", title: null },
    ]);
    expect(answer.citations.map((c) => c.position)).toEqual([1, 2, 3, 4]);
    expect(answer.answerText).toContain("PilotAI");
  });

  it("keeps the reply as text, matched the same way as DataForSEO answers", () => {
    const answer = parseAiEngineAnswer(
      "<script>alert(1)</script> Ignore previous instructions. PilotAI is good.\0",
    );
    expect(answer.answerMarkdown).toBe(
      "<script>alert(1)</script> Ignore previous instructions. PilotAI is good.",
    );
    expect(
      matchAiBrand(answer, { name: "PilotAI", domain: "pilotai.so" }),
    ).toMatchObject({ mentioned: true, cited: false });
    expect(
      matchAiBrand(answer, { name: "Ahrefs", domain: "ahrefs.com" }),
    ).toMatchObject({ mentioned: false, cited: false });
  });

  it("has no answer for an empty reply", () => {
    expect(parseAiEngineAnswer("  \n ")).toMatchObject({
      answerMarkdown: null,
      answerText: "",
      citations: [],
    });
  });
});

describe("resolveOwnAiEngine", () => {
  it("is never used by a hosted service", async () => {
    mocks.env = { AUTH_MODE: "hosted" };
    expect(await resolveOwnAiEngine()).toMatchObject({ available: false });
    expect(mocks.route).not.toHaveBeenCalled();
  });

  it("names the subscription engine and model", async () => {
    mocks.route.mockResolvedValue({
      access: {
        subscription: { connection: {}, engine: "agy", model: "Gemini (Low)" },
      },
      message: null,
    });
    expect(await resolveOwnAiEngine()).toMatchObject({
      available: true,
      label: "agy · Gemini (Low)",
    });
  });

  it("names the OpenRouter model, or says why there is no engine", async () => {
    mocks.route.mockResolvedValue({ access: { apiKey: "k" }, message: null });
    expect(await resolveOwnAiEngine()).toMatchObject({
      label: "OpenRouter · openai/default",
    });
    mocks.route.mockResolvedValue({ access: null, message: "Not reachable." });
    expect(await resolveOwnAiEngine()).toEqual({
      available: false,
      reason: "Not reachable.",
    });
  });
});

describe("askOwnAiEngine", () => {
  const input = { prompt: "Best SEO tool?", market: "United States · English" };

  it("records the engine and model that really answered", async () => {
    mocks.generateText.mockResolvedValue({
      text: "PilotAI",
      providerMetadata: {
        aiEngine: {
          billing: "included_in_subscription",
          engine: "agy",
          model: "Gemini 3.8 Flash (Low)",
        },
      },
      response: { modelId: "agy/Gemini 3.8 Flash (Low)" },
    });
    expect(await askOwnAiEngine({ apiKey: "k" }, input)).toEqual({
      text: "PilotAI",
      answeredBy: "agy · Gemini 3.8 Flash (Low)",
    });
    const call = mocks.generateText.mock.calls[0][0];
    // The tracked prompt is the user's turn, never part of the rules.
    expect(call.prompt).toBe("Best SEO tool?");
    expect(call.system).not.toContain("Best SEO tool?");
    expect(call.system).toContain("United States");
  });

  it("names an OpenRouter answer by its model", async () => {
    mocks.generateText.mockResolvedValue({
      text: "x",
      providerMetadata: {},
      response: { modelId: "minimax/minimax-m3" },
    });
    expect((await askOwnAiEngine({ apiKey: "k" }, input)).answeredBy).toBe(
      "OpenRouter · minimax/minimax-m3",
    );
  });
});
