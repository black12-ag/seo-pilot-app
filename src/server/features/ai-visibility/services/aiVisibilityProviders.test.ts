import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  offeredAiEngines,
  requireReadyAiEngines,
  splitReadyAiEngines,
} from "./aiVisibilityProviders";

const mocks = vi.hoisted(() => ({
  dataforseo: vi.fn(),
  ownEngine: vi.fn(),
}));
vi.mock("@/server/lib/provider-access", () => ({
  hasDataforseoAccess: mocks.dataforseo,
}));
vi.mock("../providers/aiEngineEvidence", () => ({
  ownAiEngineView: mocks.ownEngine,
}));

const ready = { available: true, label: "agy · m", reason: null };
const off = { available: false, label: null, reason: "It isn't reachable." };

beforeEach(() => {
  mocks.dataforseo.mockReset().mockResolvedValue(false);
  mocks.ownEngine.mockReset().mockResolvedValue(off);
});

describe("AI visibility providers", () => {
  it("offers the own engine first when there is no DataForSEO key", () => {
    expect(offeredAiEngines({ dataforseo: false, ownEngine: ready })).toEqual([
      "own_ai",
    ]);
    expect(
      offeredAiEngines({ dataforseo: true, ownEngine: ready }).at(-1),
    ).toBe("own_ai");
    expect(
      offeredAiEngines({ dataforseo: true, ownEngine: off }),
    ).not.toContain("own_ai");
    // With neither, setup still lists DataForSEO's engines.
    expect(offeredAiEngines({ dataforseo: false, ownEngine: off })).toContain(
      "chatgpt",
    );
  });

  it("collects each engine only through its own provider", async () => {
    mocks.ownEngine.mockResolvedValue(ready);
    expect(await splitReadyAiEngines(["chatgpt", "own_ai"])).toMatchObject({
      ready: ["own_ai"],
      skipped: ["chatgpt"],
    });
    mocks.dataforseo.mockResolvedValue(true);
    mocks.ownEngine.mockResolvedValue(off);
    expect(await splitReadyAiEngines(["chatgpt", "own_ai"])).toMatchObject({
      ready: ["chatgpt"],
      skipped: ["own_ai"],
    });
  });

  it("asks a provider only when one of its engines is chosen", async () => {
    await splitReadyAiEngines(["chatgpt"]);
    expect(mocks.ownEngine).not.toHaveBeenCalled();
    await splitReadyAiEngines(["own_ai"]);
    expect(mocks.dataforseo).toHaveBeenCalledTimes(1);
  });

  it("says why nothing can be collected", async () => {
    await expect(requireReadyAiEngines(["own_ai"])).rejects.toMatchObject({
      reason: "PROVIDER_NOT_CONFIGURED",
    });
    await expect(requireReadyAiEngines(["own_ai"])).rejects.toThrow(
      "It isn't reachable.",
    );
    await expect(requireReadyAiEngines(["chatgpt"])).rejects.toThrow(
      "DATAFORSEO_API_KEY",
    );
  });
});
