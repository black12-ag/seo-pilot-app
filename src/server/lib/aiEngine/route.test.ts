import { generateText } from "ai";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  buildChatAgentModel,
  buildSamChatModel,
  resolveAiRoute,
} from "@/server/lib/openrouter";
import { requireOpenRouterCostUsd } from "@/server/lib/chatAgent";
import { getAiEngineConnection } from "./client";
import { aiAccessKind, aiBackendId } from "./billing";

const engineEnv = {
  AI_ENGINE_URL: "http://engine.test",
  AI_ENGINE_TOKEN: "t".repeat(40),
};
const fetchMock = vi.fn<typeof fetch>();

function statusReply(engine: string, usable = true) {
  return Response.json({
    engine,
    model: engine === "api" ? null : "Gemini 3.8 Flash (Low)",
    usable,
    message: usable ? null : "Blocked: this CLI could reach files.",
    queue: { running: 0, waiting: 0 },
    engines: {},
  });
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllEnvs());

it("uses the API key, with no service call, when the service isn't set up", async () => {
  const route = await resolveAiRoute({ OPENROUTER_API_KEY: "key" });
  expect(route).toEqual({ access: { apiKey: "key" }, message: null });
  expect(fetchMock).not.toHaveBeenCalled();
});

it("names both routes when nothing is set up", async () => {
  const route = await resolveAiRoute({});
  expect(route.access).toBeNull();
  expect(route.message).toContain("API key");
  expect(route.message).toContain("subscription");
});

it("follows the service when it says API key", async () => {
  fetchMock.mockResolvedValueOnce(statusReply("api"));
  const route = await resolveAiRoute({
    ...engineEnv,
    OPENROUTER_API_KEY: "key",
  });
  expect(route.access).toEqual({ apiKey: "key" });
});

it("explains API key mode with no key", async () => {
  fetchMock.mockResolvedValueOnce(statusReply("api"));
  const route = await resolveAiRoute(engineEnv);
  expect(route.access).toBeNull();
  expect(route.message).toContain("OPENROUTER_API_KEY");
});

it("uses a subscription engine that passed its test, with no key at all", async () => {
  fetchMock.mockResolvedValueOnce(statusReply("agy"));
  const route = await resolveAiRoute(engineEnv);
  expect(route.access && "subscription" in route.access).toBe(true);
  expect(aiBackendId(route.access)).toBe("subscription-agy");
  expect(aiAccessKind(route.access)).toBe("subscription");
});

it("doesn't fall back to the key when the engine is blocked", async () => {
  fetchMock.mockResolvedValueOnce(statusReply("agy", false));
  const route = await resolveAiRoute({
    ...engineEnv,
    OPENROUTER_API_KEY: "key",
  });
  expect(route.access).toBeNull();
  expect(route.message).toContain("Blocked");
});

it("doesn't fall back to the key when the service is down", async () => {
  fetchMock.mockRejectedValueOnce(new TypeError("connection refused"));
  const route = await resolveAiRoute({
    ...engineEnv,
    OPENROUTER_API_KEY: "key",
  });
  expect(route.access).toBeNull();
  expect(route.message).toContain("isn't reachable");
});

it("refuses subscription mode on the hosted service", async () => {
  const hosted = {
    ...engineEnv,
    AUTH_MODE: "hosted",
    OPENROUTER_API_KEY: "key",
  };
  expect(getAiEngineConnection(hosted)).toBeNull();
  expect((await resolveAiRoute(hosted)).access).toEqual({ apiKey: "key" });
  expect(fetchMock).not.toHaveBeenCalled();
});

it.each(["ftp://engine.test", "http://user:pass@engine.test", "not a url"])(
  "ignores the bad service address %s",
  (url) => {
    expect(
      getAiEngineConnection({ ...engineEnv, AI_ENGINE_URL: url }),
    ).toBeNull();
  },
);

it("switches SAM's engine between calls, with no restart", async () => {
  const model = buildSamChatModel(
    { ...engineEnv, OPENROUTER_API_KEY: "key" },
    "low",
  );
  fetchMock.mockImplementation(async (input) => {
    const url = z.string().parse(input);
    if (url.endsWith("/v1/status")) return statusReply("agy");
    if (url.endsWith("/v1/generate"))
      return Response.json({
        engine: "agy",
        model: "Gemini 3.8 Flash (Low)",
        text: "from the subscription",
        structured: null,
        usage: null,
        billing: "included_in_subscription",
      });
    throw new Error(`Unexpected call to ${url}`);
  });
  const result = await generateText({ model, prompt: "hi" });
  expect(result.text).toBe("from the subscription");

  fetchMock.mockImplementation(async (input) => {
    const url = z.string().parse(input);
    if (url.endsWith("/v1/status")) return statusReply("agy", false);
    throw new Error(`Unexpected call to ${url}`);
  });
  await expect(
    generateText({ model, prompt: "hi", maxRetries: 0 }),
  ).rejects.toThrow("Blocked");
});

it("doesn't trip the cost check on a subscription run, and still does otherwise", () => {
  expect(
    requireOpenRouterCostUsd({
      aiEngine: {
        billing: "included_in_subscription",
        engine: "agy",
        model: "m",
      },
    }),
  ).toBe(0);
  expect(() => requireOpenRouterCostUsd({})).toThrow();
});

it("builds the engine model from subscription access", () => {
  const model = buildChatAgentModel({
    subscription: {
      connection: { url: "http://engine.test", token: "t" },
      engine: "claude",
      model: "sonnet",
    },
  });
  expect(model.modelId).toBe("claude/sonnet");
});
