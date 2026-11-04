import { CompetitorResearchRepository } from "@/server/features/competitor-research/repositories/CompetitorResearchRepository";

export const actor = {
  userId: "user",
  userEmail: "authority@example.com",
  organizationId: "organization",
  role: "owner",
  surface: "web" as const,
};
export async function setup(overrides: Record<string, unknown> = {}) {
  const { scope, snapshot } = await CompetitorResearchRepository.getSnapshot(
    actor,
    "project",
  );
  const input = {
    id: crypto.randomUUID(),
    projectId: "project",
    mode: "direct" as const,
    requestedWebsite: "https://example.com/start",
    runSeededTracking: true,
    snapshot,
    nowMs: 1000,
    ...overrides,
  };
  return { scope, input };
}
export const review = {
  name: "Project",
  domain: "example.com",
  overview: "Full overview",
  competitors: [
    {
      name: "Rival",
      domain: "rival.com",
      notes: "Actual observed notes",
      sourceUrl: "https://rival.com/about",
    },
  ],
  preserveCompetitors: false,
  suggestedTopics: [
    {
      name: "Search topic",
      prompts: ["first", "second", "third", "fourth", "fifth"],
    },
  ],
  suggestedKeywords: ["first keyword", "second keyword"],
};

export function setupRunInput(
  input: Awaited<ReturnType<typeof setup>>["input"],
) {
  return {
    id: crypto.randomUUID(),
    projectId: "project",
    requestId: crypto.randomUUID(),
    requestHash: "a".repeat(64),
    snapshot: input.snapshot,
    businessSummary: "",
    modelBackendId: null,
    modelConfigurationHash: "b".repeat(64),
    nowMs: 1001,
    deadlineAtMs: 300000,
  };
}
