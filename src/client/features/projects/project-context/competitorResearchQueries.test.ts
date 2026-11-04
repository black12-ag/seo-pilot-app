import { afterEach, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { competitorResearchRunSchema } from "@/types/schemas/competitorResearch";

vi.mock("@/serverFunctions/competitorResearch", () => ({
  getCompetitorResearch: vi.fn(),
  getCompetitorResearchRun: vi.fn(),
  acceptCompetitorResearch: vi.fn(),
}));
import { CompetitorResearchReview } from "./CompetitorResearchReview";
import {
  clearPendingCompetitorAccept,
  clearPendingCompetitorStart,
  newCompetitorStart,
  readPendingCompetitorAccept,
  readPendingCompetitorStart,
  savePendingCompetitorAccept,
  savePendingCompetitorStart,
} from "./competitorResearchQueries";

const projectId = "11111111-1111-4111-8111-111111111111";
const state = {
  projectId,
  contextVersion: 3,
  contextHash: "a".repeat(64),
  capabilityFingerprint: "b".repeat(64),
};

function session() {
  const rows = new Map<string, string>();
  vi.stubGlobal("window", {
    sessionStorage: {
      getItem: (key: string) => rows.get(key) ?? null,
      setItem: (key: string, value: string) => {
        rows.set(key, value);
      },
      removeItem: (key: string) => {
        rows.delete(key);
      },
    },
  });
  return rows;
}
afterEach(() => vi.unstubAllGlobals());

it("keeps the exact paid request across reload and isolates project and user", () => {
  session();
  const first = newCompetitorStart(state);
  savePendingCompetitorStart(projectId, "user-a", first);
  expect(readPendingCompetitorStart(projectId, "user-a")).toEqual(first);
  expect(readPendingCompetitorStart(projectId, "user-b")).toBeNull();
  expect(
    readPendingCompetitorStart(
      "22222222-2222-4222-8222-222222222222",
      "user-a",
    ),
  ).toBeNull();
  clearPendingCompetitorStart(projectId, "user-a");
  expect(readPendingCompetitorStart(projectId, "user-a")).toBeNull();
  expect(newCompetitorStart(state).requestId).not.toBe(first.requestId);
});

it("ignores an invalid stored receipt instead of changing its context hash", () => {
  const rows = session();
  rows.set(
    `competitor-research:pending:user-a:${projectId}`,
    JSON.stringify({ ...newCompetitorStart(state), contextHash: "forged" }),
  );
  expect(readPendingCompetitorStart(projectId, "user-a")).toBeNull();
});

it("keeps an exact uncertain review receipt scoped to the same person, project and run", () => {
  session();
  const runId = crypto.randomUUID();
  const input = {
    projectId,
    runId,
    mutationId: crypto.randomUUID(),
    expectedContextVersion: 3,
    selections: [
      { candidateId: crypto.randomUUID(), name: "Rival", notes: "Same market" },
    ],
  };
  expect(savePendingCompetitorAccept(projectId, "user-a", runId, input)).toBe(
    true,
  );
  expect(readPendingCompetitorAccept(projectId, "user-a", runId)).toEqual(
    input,
  );
  expect(readPendingCompetitorAccept(projectId, "user-b", runId)).toBeNull();
  expect(
    readPendingCompetitorAccept(projectId, "user-a", crypto.randomUUID()),
  ).toBeNull();
  clearPendingCompetitorAccept(projectId, "user-a", runId);
  expect(readPendingCompetitorAccept(projectId, "user-a", runId)).toBeNull();
});

it("reports storage denial instead of promising reload recovery", () => {
  const runId = crypto.randomUUID();
  vi.stubGlobal("window", {
    sessionStorage: {
      setItem: () => {
        throw new Error("denied");
      },
    },
  });
  expect(
    savePendingCompetitorAccept(projectId, "user-a", runId, {
      projectId,
      runId,
      mutationId: crypto.randomUUID(),
      expectedContextVersion: 3,
      selections: [],
    }),
  ).toBe(false);
});

it("renders a historical reviewed run without contradictory stale-acceptance guidance", () => {
  const run = competitorResearchRunSchema.parse({
    id: crypto.randomUUID(),
    projectId,
    origin: "explicit",
    state: "finished",
    outcome: "complete",
    reasons: [],
    modelIncludedInSubscription: false,
    snapshot: {
      domain: "example.com",
      locationCode: 2840,
      languageCode: "en",
      contextVersion: 3,
      contextHash: "a".repeat(64),
    },
    limits: {
      profile: "competitor-discovery-v1",
      maxQueries: 2,
      searchDepth: 10,
      maxCandidateSites: 5,
      maxPages: 6,
      maxPublicHttpRequests: 24,
      maxModelCalls: 1,
      maxModelRequestBytes: 32768,
      maxModelOutputJsonBytes: 16384,
      requestedOutputTokens: 2000,
      maxRendererAttempts: 0,
      maxPaidRetries: 0,
      maxRunDurationMs: 240000,
    },
    createdAtMs: 1,
    startedAtMs: 1,
    deadlineAtMs: 240001,
    finishedAtMs: 2,
    candidates: [],
    knownCostUsd: null,
    costComplete: true,
    modelUsage: null,
    billingState: "not_started",
    reviewState: "reviewed",
    canAccept: false,
  });
  const markup = renderToStaticMarkup(
    createElement(
      QueryClientProvider,
      { client: new QueryClient() },
      createElement(CompetitorResearchReview, {
        projectId,
        userId: "user-a",
        run,
        contextVersion: 4,
        onRefresh: () => {},
      }),
    ),
  );
  expect(markup).toContain("historical review receipt");
  expect(markup).not.toContain("Project context changed since this run");
});
