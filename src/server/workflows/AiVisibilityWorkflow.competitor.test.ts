import { expect, it, vi } from "vitest";
import type { WorkflowStep } from "cloudflare:workers";

const { run, pgStep, legacy } = vi.hoisted(() => ({
  run: vi.fn(async (runId: string) => ({ runId })),
  pgStep: vi.fn(
    async (
      _step: unknown,
      _name: string,
      _config: unknown,
      fn: () => Promise<unknown>,
    ) => fn(),
  ),
  legacy: vi.fn(),
}));
vi.mock("cloudflare:workers", () => ({
  WorkflowEntrypoint: vi.fn(),
  env: { DATABASE_PROVIDER: "d1" },
}));
vi.mock("./yieldingStep", () => ({ yieldingStep: (step: unknown) => step }));
vi.mock("./pgStep", () => ({ pgStep }));
vi.mock(
  "@/server/features/competitor-research/services/competitorResearchExecution",
  () => ({ runCompetitorResearch: run }),
);
vi.mock(
  "@/server/features/ai-visibility/services/aiVisibilityCollection",
  () => ({ prepareAiRun: legacy }),
);
vi.mock("@/server/features/ai-visibility/services/aiResearchKeywords", () => ({
  runAiResearchSetup: legacy,
}));
vi.mock(
  "@/server/features/ai-visibility/services/aiVisibilityRunOutcome",
  () => ({ finalizeAiRun: legacy, markAiRunFailed: legacy }),
);
vi.mock("@/server/features/ai-visibility/services/aiVisibilityBilling", () => ({
  settleAiRun: legacy,
}));
vi.mock("@/server/lib/dataforseo", () => ({ AI_TRACKING_HOLD_TTL_MS: 1000 }));
import { AiVisibilityWorkflow } from "./AiVisibilityWorkflow";

it("runs the durable competitor ID in a single zero-retry step without a customer payload", async () => {
  // The mocked base and pgStep do not use Cloudflare bindings or execution context.
  // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion -- mocked WorkflowEntrypoint never reads its constructor arguments
  const workflow = new AiVisibilityWorkflow({} as ExecutionContext, {} as Env);
  const result = await workflow.run(
    {
      payload: { competitorResearchRunId: "run" },
      instanceId: "run",
      timestamp: new Date(),
    },
    // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion -- mocked pgStep never calls the step
    {} as WorkflowStep,
  );
  expect(result).toEqual({ runId: "run" });
  expect(pgStep).toHaveBeenCalledWith(
    expect.anything(),
    "competitor-research",
    {
      retries: { limit: 0, delay: "1 second" },
      timeout: "5 minutes",
    },
    expect.any(Function),
  );
  expect(run).toHaveBeenCalledExactlyOnceWith("run");
  expect(legacy).not.toHaveBeenCalled();
});
