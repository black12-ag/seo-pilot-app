import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, it, vi } from "vitest";
import type { StartCompetitorResearchResult } from "@/types/schemas/competitorResearch";

const hooks = vi.hoisted(() => {
  let onSuccess:
    | ((result: StartCompetitorResearchResult) => Promise<unknown>)
    | undefined;
  return {
    setOnSuccess: (callback: typeof onSuccess) => {
      onSuccess = callback;
    },
    getOnSuccess: () => onSuccess,
    start: vi.fn(),
  };
});
const projectId = "11111111-1111-4111-8111-111111111111";
vi.mock("@/serverFunctions/competitorResearch", () => ({
  getCompetitorResearch: vi.fn(),
  getCompetitorResearchRun: vi.fn(),
  startCompetitorResearch: hooks.start,
  acceptCompetitorResearch: vi.fn(),
}));
vi.mock("@/serverFunctions/projectContext", () => ({
  updateProjectContext: vi.fn(),
}));
vi.mock("@/lib/auth-client", () => ({
  useSession: () => ({ data: { user: { id: "user-a" } } }),
}));
vi.mock("@tanstack/react-query", async (importOriginal) => ({
  ...(await importOriginal()),
  useQueryClient: () => ({ invalidateQueries: async () => undefined }),
  useQuery: () => ({
    isPending: false,
    isError: false,
    isFetching: false,
    data: {
      projectId,
      ready: true,
      blockedReasons: [],
      contextVersion: 3,
      contextHash: "a".repeat(64),
      capabilityFingerprint: "b".repeat(64),
      activeRunId: null,
      recentRuns: [],
      limits: {
        maxQueries: 2,
        searchDepth: 10,
        maxPages: 6,
        maxModelCalls: 1,
        maxRunDurationMs: 240000,
      },
    },
  }),
  useMutation: (options: {
    onSuccess: (result: StartCompetitorResearchResult) => Promise<unknown>;
  }) => {
    hooks.setOnSuccess(options.onSuccess);
    return { isPending: false, isError: false, mutate: vi.fn() };
  },
}));
import { CompetitorResearchPanel } from "./CompetitorResearchPanel";

afterEach(() => vi.unstubAllGlobals());

it("clears an unadmitted busy start so Resume cannot launch it later", async () => {
  const removeItem = vi.fn();
  vi.stubGlobal("window", { sessionStorage: { removeItem } });
  const html = renderToStaticMarkup(
    createElement(CompetitorResearchPanel, { projectId }),
  );
  expect(html).toContain("Discover competitors");
  expect(hooks.start).not.toHaveBeenCalled();
  const onSuccess = hooks.getOnSuccess();
  if (!onSuccess) throw new Error("Panel start mutation missing");
  await onSuccess({
    ok: false,
    code: "run_in_progress",
    activeRunId: crypto.randomUUID(),
    currentContextVersion: 3,
  });
  expect(removeItem).toHaveBeenCalledWith(
    `competitor-research:pending:user-a:${projectId}`,
  );
});
