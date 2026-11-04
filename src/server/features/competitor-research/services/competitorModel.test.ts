import { beforeEach, expect, it, vi } from "vitest";

const { generateText } = vi.hoisted(() => ({ generateText: vi.fn() }));
vi.mock("ai", () => ({
  generateText,
  Output: { object: (value: unknown) => value },
}));
vi.mock("@/server/lib/openrouter", () => ({
  requireAiAccess: async () => ({ apiKey: "test" }),
  buildChatAgentModel: () => ({ modelId: "test-model" }),
}));
vi.mock("@/server/lib/chatAgent", () => ({
  requireOpenRouterCostUsd: () => 0.02,
}));
vi.mock("@/server/lib/runtime-env", () => ({
  getOptionalEnvValue: async () => undefined,
}));
import { classifyCompetitorCandidates } from "./competitorModel";

const candidateId = crypto.randomUUID();
const request = {
  v: 1 as const,
  operation: "classify_competitors" as const,
  requestId: crypto.randomUUID(),
  runId: crypto.randomUUID(),
  deadlineAtMs: Date.now() + 1000,
  business: {
    domain: "example.com",
    summary: "Business",
    locationCode: 2840,
    languageCode: "en",
  },
  candidates: [
    {
      id: candidateId,
      domain: "rival.com",
      evidence: {
        url: "https://rival.com/",
        excerpt: "Rival",
        textHash: "a".repeat(64),
        capturedAtMs: Date.now(),
      },
    },
  ],
};
beforeEach(() => {
  generateText.mockResolvedValue({
    output: { selections: [{ candidateId, reason: "Same market" }] },
    response: { modelId: "actual-model" },
    providerMetadata: {},
    usage: { inputTokens: 100, outputTokens: 20 },
  });
});

it("uses one tool-free model call with zero retries and actual usage", async () => {
  const result = await classifyCompetitorCandidates(request, {
    signal: AbortSignal.timeout(1000),
  });
  expect(result.status).toBe("succeeded");
  if (result.status === "succeeded")
    expect(result.usage).toMatchObject({
      modelId: "actual-model",
      costUsd: 0.02,
      inputTokens: 100,
      outputTokens: 20,
    });
  expect(generateText).toHaveBeenCalledTimes(1);
  expect(generateText.mock.calls[0]?.[0]).toMatchObject({
    maxRetries: 0,
    maxOutputTokens: 2000,
  });
  expect(generateText.mock.calls[0]?.[0]).not.toHaveProperty("tools");
});

it("rejects a foreign candidate ID without a repair call", async () => {
  generateText.mockResolvedValueOnce({
    output: {
      selections: [{ candidateId: crypto.randomUUID(), reason: "Foreign" }],
    },
    response: { modelId: "model" },
    providerMetadata: {},
    usage: {},
  });
  await expect(
    classifyCompetitorCandidates(request, {
      signal: AbortSignal.timeout(1000),
    }),
  ).rejects.toThrow();
  expect(generateText).toHaveBeenCalledTimes(1);
});

it("records quota use and no price for a subscription run", async () => {
  generateText.mockResolvedValue({
    output: { selections: [{ candidateId, reason: "Same market" }] },
    response: { modelId: "agy/Gemini 3.8 Flash (Low)" },
    providerMetadata: {
      aiEngine: {
        billing: "included_in_subscription",
        engine: "agy",
        model: "Gemini 3.8 Flash (Low)",
      },
    },
    usage: { inputTokens: 100, outputTokens: 20 },
  });
  const result = await classifyCompetitorCandidates(request, {
    signal: AbortSignal.timeout(1000),
  });
  expect(result.status).toBe("succeeded");
  if (result.status === "succeeded")
    expect(result.usage).toMatchObject({
      backendId: "subscription-agy",
      modelId: "agy/Gemini 3.8 Flash (Low)",
      basis: "quota",
      costUsd: null,
    });
});
