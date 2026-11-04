import { expect, it, vi } from "vitest";
import type { WorkflowStep } from "cloudflare:workers";

const { run, pgStep, legacy } = vi.hoisted(() => ({
  run: vi.fn(async (attemptId: string) => ({ attemptId })),
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
vi.mock("cloudflare:workers", () => ({ WorkflowEntrypoint: vi.fn() }));
vi.mock("./yieldingStep", () => ({ yieldingStep: (step: unknown) => step }));
vi.mock("./pgStep", () => ({ pgStep }));
vi.mock(
  "@/server/features/projects/services/websiteResearchAttemptExecution",
  () => ({
    executeWebsiteResearchAttempt: run,
  }),
);
vi.mock(
  "@/server/features/competitor-research/services/competitorResearchExecution",
  () => ({
    runCompetitorResearch: legacy,
  }),
);
vi.mock("@/server/features/ai-visibility/services/aiResearchKeywords", () => ({
  runAiResearchSetup: legacy,
}));
vi.mock(
  "@/server/features/ai-visibility/services/aiVisibilityCollection",
  () => ({ prepareAiRun: legacy }),
);
vi.mock(
  "@/server/features/ai-visibility/services/aiVisibilityRunOutcome",
  () => ({ finalizeAiRun: legacy, markAiRunFailed: legacy }),
);
vi.mock("@/server/features/ai-visibility/services/aiVisibilityBilling", () => ({
  settleAiRun: legacy,
}));
vi.mock("@/server/lib/dataforseo", () => ({ AI_TRACKING_HOLD_TTL_MS: 1000 }));

import { AiVisibilityWorkflow } from "./AiVisibilityWorkflow";

it("executes only the durable setup attempt ID in a zero-retry paid step", async () => {
  // The mocked base and pgStep do not use Cloudflare bindings or step methods.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- mocked WorkflowEntrypoint has no constructor behavior
  const workflow = new AiVisibilityWorkflow({} as ExecutionContext, {} as Env);
  const result = await workflow.run(
    {
      payload: { setupAttemptId: "attempt" },
      instanceId: "ai-research-setup-attempt",
      timestamp: new Date(),
    },
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- mocked pgStep never calls the step
    {} as WorkflowStep,
  );
  expect(result).toEqual({ attemptId: "attempt" });
  expect(pgStep).toHaveBeenCalledWith(
    expect.anything(),
    "research-setup-attempt",
    { retries: { limit: 0, delay: "1 second" }, timeout: "5 minutes" },
    expect.any(Function),
  );
  expect(run).toHaveBeenCalledExactlyOnceWith("attempt");
  expect(legacy).not.toHaveBeenCalled();
});
