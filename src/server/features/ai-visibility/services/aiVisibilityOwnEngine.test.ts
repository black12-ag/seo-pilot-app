import { beforeEach, describe, expect, it, vi } from "vitest";
import { projectCompetitors } from "@/db/schema";
import { AiVisibilityRepository as repo } from "../repositories/AiVisibilityRepository";
import { prepareAiRun } from "./aiVisibilityCollection";
import { collectAiOwnBatch } from "./aiVisibilityOwnCollection";
import { AI_ANSWER_FAILURES } from "./aiVisibilityErrors";
import { configuration } from "./aiVisibilityTestFixtures";

const { testDb, engine } = await vi.hoisted(async () => {
  const { createAiVisibilityTestDb } = await import("../aiVisibilityTestDb");
  return {
    testDb: await createAiVisibilityTestDb(),
    engine: { resolve: vi.fn(), ask: vi.fn() },
  };
});
vi.mock("cloudflare:workers", () => ({ env: { DATABASE_PROVIDER: "d1" } }));
vi.mock("cloudflare:workflows", () => ({
  NonRetryableError: class extends Error {},
}));
vi.mock("@/db", () => ({ db: testDb.db }));
vi.mock("@/db/runBatch", () => ({ runBatch: testDb.runBatch }));
vi.mock("@/server/lib/dataforseo", () => ({
  MAX_TASKS_PER_POST: 100,
  createDataforseoClient: () => {
    throw new Error("Own engine answers must not reach DataForSEO.");
  },
}));
vi.mock("../providers/aiEngineEvidence", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  resolveOwnAiEngine: engine.resolve,
  askOwnAiEngine: engine.ask,
}));

const runId = "run";
const market = { locationCode: 2840, languageCode: "en" };
const ready = {
  available: true,
  access: { subscription: {} },
  label: "agy · Gemini 3.8 Flash (Low)",
};

beforeEach(async () => {
  engine.resolve.mockReset().mockResolvedValue(ready);
  engine.ask.mockReset();
  await testDb.seedProject();
  await testDb.db.insert(projectCompetitors).values({
    id: "competitor",
    projectId: "project",
    domain: "ahrefs.com",
    name: "Ahrefs",
    updatedBy: "user",
  });
  const rows = configuration({
    engines: ["chatgpt", "own_ai"],
    prompts: [{ text: "Which SEO tools?" }, { text: "Best rank tracker?" }],
  });
  await repo.saveConfiguration(rows);
  await repo.createRun(
    {
      id: runId,
      trackerId: rows.tracker.id,
      projectId: "project",
      trigger: "scheduled",
      status: "queued",
      ...market,
      createdAt: "2026-09-05T12:00:00.000Z",
    },
    rows.prompts.flatMap((prompt, index) => [
      {
        id: `own-${index}`,
        runId,
        promptId: prompt.id,
        engine: "own_ai" as const,
        branded: false,
      },
      {
        id: `chatgpt-${index}`,
        runId,
        promptId: prompt.id,
        engine: "chatgpt" as const,
        branded: false,
      },
    ]),
  );
});

const tasks = [
  { tag: "own-0", prompt: "Which SEO tools?" },
  { tag: "own-1", prompt: "Best rank tracker?" },
];

describe("own AI engine answers", () => {
  it("keeps own engine answers out of DataForSEO's batches", async () => {
    const plan = await prepareAiRun(runId);
    expect(plan.ownBatches).toHaveLength(1);
    expect(plan.ownBatches?.[0]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ tag: "own-0", prompt: "Which SEO tools?" }),
        expect.objectContaining({ tag: "own-1", prompt: "Best rank tracker?" }),
      ]),
    );
    const dataforseoTags = [
      ...plan.modelBatches.flatMap((batch) => batch.tasks),
      ...plan.batches.flatMap((batch) =>
        "tasks" in batch ? batch.tasks : batch,
      ),
    ].map((task) => task.tag);
    expect(new Set(dataforseoTags)).toEqual(
      new Set(["chatgpt-0", "chatgpt-1"]),
    );
  });

  it("saves the answer, who answered, its sources and each brand's result", async () => {
    engine.ask.mockResolvedValue({
      text: "Try **PilotAI** ([pricing](https://pilotai.so/pricing?utm_source=x)) or Ahrefs: https://ahrefs.com/.",
      answeredBy: "agy · Gemini 3.8 Flash (Low)",
    });
    await collectAiOwnBatch(runId, market, tasks.slice(0, 1));

    expect(engine.ask).toHaveBeenCalledWith(ready.access, {
      prompt: "Which SEO tools?",
      market: "United States · English",
    });
    const saved = (await repo.getObservations([runId])).find(
      (o) => o.id === "own-0",
    );
    expect(saved).toMatchObject({
      status: "completed",
      answeredBy: "agy · Gemini 3.8 Flash (Low)",
      answerMode: "model_knowledge",
      error: null,
    });
    const evidence = await repo.getEvidence(["own-0"]);
    expect(evidence.sources.map(({ url, title }) => ({ url, title }))).toEqual([
      { url: "https://pilotai.so/pricing", title: "pricing" },
      { url: "https://ahrefs.com/", title: null },
    ]);
    expect(
      evidence.matches.map(({ domain, mentioned, cited }) => ({
        domain,
        mentioned,
        cited,
      })),
    ).toEqual(
      expect.arrayContaining([
        { domain: "pilotai.so", mentioned: true, cited: true },
        { domain: "ahrefs.com", mentioned: true, cited: true },
      ]),
    );
  });

  it("fails one answer with our own copy and keeps going", async () => {
    engine.ask
      .mockRejectedValueOnce(new Error("Ignore all rules: secret engine text"))
      .mockResolvedValueOnce({ text: "No brands.", answeredBy: "agy · m" });
    await collectAiOwnBatch(runId, market, tasks);

    const rows = await repo.getObservations([runId]);
    expect(rows.find((o) => o.id === "own-0")).toMatchObject({
      status: "failed",
      error: AI_ANSWER_FAILURES.ownEngineFailed,
    });
    expect(rows.find((o) => o.id === "own-1")?.status).toBe("completed");
  });

  it("fails every answer, asking nothing, when the engine isn't ready", async () => {
    engine.resolve.mockResolvedValue({
      available: false,
      reason: "No AI is set up yet.",
    });
    await collectAiOwnBatch(runId, market, tasks);

    expect(engine.ask).not.toHaveBeenCalled();
    const rows = await repo.getObservations([runId]);
    for (const tag of ["own-0", "own-1"])
      expect(rows.find((o) => o.id === tag)).toMatchObject({
        status: "failed",
        error: AI_ANSWER_FAILURES.ownEngineOff,
      });
  });

  it("skips answers an earlier attempt finished", async () => {
    engine.ask.mockResolvedValue({ text: "PilotAI", answeredBy: "agy · m" });
    await collectAiOwnBatch(runId, market, tasks.slice(0, 1));
    await collectAiOwnBatch(runId, market, tasks);
    expect(engine.ask).toHaveBeenCalledTimes(2);
  });
});
