import { env } from "cloudflare:workers";
import { z } from "zod";
import { ContentRepository } from "@/server/features/content/repositories/ContentRepository";
import { ProjectContextRepository } from "@/server/features/project-context/repositories/ProjectContextRepository";
import type { CompetitorResearchScope } from "@/server/features/competitor-research/repositories/CompetitorResearchRepository";
import { ProjectRepository } from "../repositories/ProjectRepository";
import { AppError } from "@/server/lib/errors";
import { usesBetterAuthServer } from "@/server/lib/runtime-env";
import {
  websiteResearchSchema,
  type WebsiteResearch,
} from "@/types/schemas/projectWebsite";

type Inspection =
  | { kind: "clear" }
  | { kind: "running" }
  | { kind: "review"; review: WebsiteResearch }
  | { kind: "unavailable" };

const legacyOutputSchema = z.object({
  review: websiteResearchSchema
    .extend({
      suggestedKeywords: websiteResearchSchema.shape.suggestedKeywords.default(
        [],
      ),
    })
    .nullable(),
});
const inFlight = new Set([
  "queued",
  "running",
  "waiting",
  "waitingForPause",
  "paused",
]);

async function setupAlreadySaved(projectId: string) {
  const [sections, competitors] = await Promise.all([
    ProjectContextRepository.listSections(projectId),
    ProjectContextRepository.listCompetitors(projectId),
  ]);
  return (
    competitors.length > 0 &&
    sections.some((section) => section.key === "business_overview")
  );
}

/** This scope comes from an authorized snapshot, but authority can change. */
export async function inspectLegacySetupBeforePaidStart(
  scope: CompetitorResearchScope,
  projectId: string,
): Promise<Inspection> {
  if (!scope.actor.userId || !scope.actor.organizationId)
    throw new AppError("UNAUTHENTICATED");
  if ((await usesBetterAuthServer()) !== scope.requireMembership)
    throw new AppError("FORBIDDEN");
  const [project, membership] = await Promise.all([
    ProjectRepository.getProjectForOrganization(
      projectId,
      scope.actor.organizationId,
    ),
    scope.requireMembership
      ? ContentRepository.getMembership(
          scope.actor.organizationId,
          scope.actor.userId,
        )
      : null,
  ]);
  if (!project) throw new AppError("NOT_FOUND");
  if (
    scope.requireMembership &&
    (!membership ||
      membership.id !== scope.memberId ||
      membership.role !== scope.actor.role)
  )
    throw new AppError("FORBIDDEN");
  if (project.legacySetupAbsenceProven === 1) return { kind: "clear" };
  try {
    const instance = await env.AI_VISIBILITY_WORKFLOW.get(
      `ai-research-setup-${projectId}`,
    );
    const status = await instance.status();
    if (inFlight.has(status.status)) return { kind: "running" };
    if (status.status === "unknown") return { kind: "unavailable" };
    if (status.status === "complete") {
      // Only an explicit `review: null` clears. Unreadable output may hide a
      // finished review, so it must not admit a fresh paid run.
      const output = legacyOutputSchema.safeParse(status.output);
      if (!output.success) return { kind: "unavailable" };
      if (!output.data.review) return { kind: "clear" };
      // The Workflow keeps its output after the review is saved.
      return (await setupAlreadySaved(projectId))
        ? { kind: "clear" }
        : { kind: "review", review: output.data.review };
    }
    if (["errored", "terminated"].includes(status.status))
      return { kind: "clear" };
    return { kind: "unavailable" };
  } catch {
    return { kind: "unavailable" };
  }
}

/** Trusted legacy callers have already authorized the project separately. */
export async function assertLegacySetupLaunchAllowed(
  projectId: string,
  organizationId: string,
): Promise<void> {
  const project = await ProjectRepository.getProjectForOrganization(
    projectId,
    organizationId,
  );
  if (!project) throw new AppError("NOT_FOUND");
  if (project.legacySetupAbsenceProven === 1)
    throw new AppError("CONFLICT", "legacy_setup_unavailable_after_cutover");
}
