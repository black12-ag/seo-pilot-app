import { queryOptions } from "@tanstack/react-query";
import {
  getCompetitorResearch,
  getCompetitorResearchRun,
} from "@/serverFunctions/competitorResearch";
import {
  acceptCompetitorResearchInputSchema,
  startCompetitorResearchInputSchema,
  type AcceptCompetitorResearchInput,
  type CompetitorResearchState,
  type StartCompetitorResearchInput,
} from "@/types/schemas/competitorResearch";

const competitorResearchQueryKey = (projectId: string) =>
  ["competitor-research", projectId] as const;
const competitorResearchRunQueryKey = (projectId: string, runId: string) =>
  ["competitor-research", projectId, runId] as const;

export const competitorResearchQueryOptions = (projectId: string) =>
  queryOptions({
    queryKey: competitorResearchQueryKey(projectId),
    queryFn: () => getCompetitorResearch({ data: { projectId } }),
    staleTime: 0,
  });

export const competitorResearchRunQueryOptions = (
  projectId: string,
  runId: string,
) =>
  queryOptions({
    queryKey: competitorResearchRunQueryKey(projectId, runId),
    queryFn: () => getCompetitorResearchRun({ data: { projectId, runId } }),
    staleTime: 0,
    refetchInterval: (query) =>
      query.state.data?.state === "available" &&
      query.state.data.run.state !== "finished"
        ? 3000
        : false,
  });

const pendingKey = (projectId: string, userId: string) =>
  `competitor-research:pending:${userId}:${projectId}`;
const pendingReviewKey = (projectId: string, userId: string, runId: string) =>
  `competitor-research:review:${userId}:${projectId}:${runId}`;

export function readPendingCompetitorStart(
  projectId: string,
  userId: string,
): StartCompetitorResearchInput | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(pendingKey(projectId, userId));
    if (!raw) return null;
    const parsed = startCompetitorResearchInputSchema.safeParse(
      JSON.parse(raw),
    );
    return parsed.success && parsed.data.projectId === projectId
      ? parsed.data
      : null;
  } catch {
    return null;
  }
}

export function savePendingCompetitorStart(
  projectId: string,
  userId: string,
  input: StartCompetitorResearchInput,
) {
  try {
    window.sessionStorage.setItem(
      pendingKey(projectId, userId),
      JSON.stringify(startCompetitorResearchInputSchema.parse(input)),
    );
  } catch {
    /* In-memory state still permits same-page resume. */
  }
}

export function clearPendingCompetitorStart(projectId: string, userId: string) {
  try {
    window.sessionStorage.removeItem(pendingKey(projectId, userId));
  } catch {
    /* Storage can be unavailable. */
  }
}

export function readPendingCompetitorAccept(
  projectId: string,
  userId: string,
  runId: string,
): AcceptCompetitorResearchInput | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(
      pendingReviewKey(projectId, userId, runId),
    );
    if (!raw) return null;
    const parsed = acceptCompetitorResearchInputSchema.safeParse(
      JSON.parse(raw),
    );
    return parsed.success &&
      parsed.data.projectId === projectId &&
      parsed.data.runId === runId
      ? parsed.data
      : null;
  } catch {
    return null;
  }
}

export function savePendingCompetitorAccept(
  projectId: string,
  userId: string,
  runId: string,
  input: AcceptCompetitorResearchInput,
): boolean {
  try {
    window.sessionStorage.setItem(
      pendingReviewKey(projectId, userId, runId),
      JSON.stringify(acceptCompetitorResearchInputSchema.parse(input)),
    );
    return true;
  } catch {
    return false;
  }
}

export function clearPendingCompetitorAccept(
  projectId: string,
  userId: string,
  runId: string,
) {
  try {
    window.sessionStorage.removeItem(
      pendingReviewKey(projectId, userId, runId),
    );
  } catch {
    // Storage can be unavailable; local state is cleared by the caller.
  }
}

export function newCompetitorStart(
  state: Pick<
    CompetitorResearchState,
    "projectId" | "contextVersion" | "contextHash" | "capabilityFingerprint"
  >,
): StartCompetitorResearchInput {
  return {
    projectId: state.projectId,
    requestId: crypto.randomUUID(),
    expectedContextVersion: state.contextVersion,
    contextHash: state.contextHash,
    capabilityFingerprint: state.capabilityFingerprint,
    confirmedPaidWork: true,
  };
}
