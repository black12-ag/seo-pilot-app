import { beforeEach, expect, it, vi } from "vitest";
import type * as RuntimeEnv from "@/server/lib/runtime-env";

const { workerEnv } = vi.hoisted(() => ({
  workerEnv: { current: {} as Record<string, string> },
}));
vi.mock("@/server/lib/runtime-env", async (importOriginal) => ({
  ...(await importOriginal<typeof RuntimeEnv>()),
  getWorkersEnv: async () => workerEnv.current,
}));

import { AppError } from "@/server/lib/errors";
import { AiEngineSettings } from "./settings";

const engineEnv = {
  AI_ENGINE_URL: "http://engine.test",
  AI_ENGINE_TOKEN: "t".repeat(40),
};
const status = {
  engine: "agy",
  model: "Gemini 3.8 Flash (Low)",
  usable: true,
  message: null,
  queue: { running: 0, waiting: 0 },
  engines: {},
};
const fetchMock = vi.fn<typeof fetch>();
const admin = { role: "admin" };
const owner = { role: "owner" };
const member = { role: "member" };

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  workerEnv.current = { ...engineEnv };
});

it.each([
  ["get", () => AiEngineSettings.get(member)],
  ["set", () => AiEngineSettings.set(member, { engine: "agy", model: null })],
  ["test", () => AiEngineSettings.test(member, "agy")],
])(
  "refuses a member on %s and never calls the service",
  async (_name, call) => {
    await expect(call()).rejects.toMatchObject({
      message: "Your organization role does not allow this action.",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  },
);

it("refuses an unknown role", async () => {
  await expect(AiEngineSettings.get({ role: "guest" })).rejects.toBeInstanceOf(
    AppError,
  );
});

it.each([
  ["owner", owner],
  ["admin", admin],
])("lets an %s read and change the engine", async (_name, actor) => {
  fetchMock.mockImplementation(async () => Response.json(status));
  await expect(AiEngineSettings.get(actor)).resolves.toMatchObject({
    state: "ready",
    status: { engine: "agy" },
  });
  await expect(
    AiEngineSettings.set(actor, { engine: "agy", model: null }),
  ).resolves.toMatchObject({ engine: "agy" });
});

it("says plainly that the hosted service can't use a subscription", async () => {
  workerEnv.current = { ...engineEnv, AUTH_MODE: "hosted" };
  await expect(AiEngineSettings.get(admin)).resolves.toEqual({
    state: "hosted",
  });
  for (const call of [
    () => AiEngineSettings.set(admin, { engine: "agy", model: null }),
    () => AiEngineSettings.test(admin, "agy"),
  ])
    await expect(call()).rejects.toThrow(
      "A paid hosted service serving customers can't use a personal subscription.",
    );
  expect(fetchMock).not.toHaveBeenCalled();
});

it("shows how to set up without the env vars", async () => {
  workerEnv.current = { OPENROUTER_API_KEY: "key" };
  await expect(AiEngineSettings.get(admin)).resolves.toEqual({
    state: "not_configured",
    apiKeySet: true,
  });
  await expect(
    AiEngineSettings.set(admin, { engine: "agy", model: null }),
  ).rejects.toMatchObject({
    message: "Set AI_ENGINE_URL and AI_ENGINE_TOKEN first.",
  });
});

it("reports a service that can't be reached", async () => {
  fetchMock.mockRejectedValue(new TypeError("connection refused"));
  await expect(AiEngineSettings.get(admin)).resolves.toMatchObject({
    state: "unreachable",
  });
});
