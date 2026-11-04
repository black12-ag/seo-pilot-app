import { waitUntil } from "cloudflare:workers";
import {
  checkUsageCreditsDepleted,
  type BillingCustomerContext,
} from "@/server/billing/subscription";
import {
  isHostedServerAuthMode,
  usesBetterAuthServer,
} from "@/server/lib/runtime-env";
import type { ContextAuthor } from "@/types/schemas/projectContext";
import { ProjectContextRepository } from "@/server/features/project-context/repositories/ProjectContextRepository";
import { ProjectRepository } from "@/server/features/projects/repositories/ProjectRepository";
import { saveWebsiteSetup } from "@/server/features/projects/repositories/ProjectWebsiteRepository";
import { prepareWebsiteSetupEvidence } from "@/server/features/projects/repositories/websiteSetupEvidenceWrites";
import { researchWebsite } from "@/server/features/projects/services/websiteResearch";
import { normalizeBacklinksTarget } from "@/server/lib/dataforseoBacklinksTarget";
import { AppError } from "@/server/lib/errors";
import {
  prepareWebsiteTracking,
  startWebsiteTrackingRun,
} from "@/server/features/ai-visibility/services/websiteTrackingSetup";
import {
  saveProjectWebsiteSetupSchema,
  type SaveProjectWebsiteSetup,
} from "@/types/schemas/projectWebsite";
import type { CompetitorResearchActor } from "@/types/schemas/competitorResearch";
import { sha256Hex } from "@/server/lib/audit/ids";
import { WebsiteResearchAttemptService } from "./WebsiteResearchAttemptService";
import { assertLegacySetupLaunchAllowed } from "./legacySetupGate";

async function requireProject(
  customer: BillingCustomerContext,
  projectId: string,
) {
  const project = await ProjectRepository.getProjectForOrganization(
    projectId,
    customer.organizationId,
  );
  if (!project) throw new AppError("NOT_FOUND");
  return project;
}
async function research(
  projectId: string,
  website: string,
  customer: BillingCustomerContext,
) {
  const project = await requireProject(customer, projectId);
  await assertLegacySetupLaunchAllowed(projectId, customer.organizationId);
  if (await usesBetterAuthServer())
    throw new AppError(
      "VALIDATION_ERROR",
      "A confirmed website research request ID is required.",
    );
  // Any positive credit balance admits the whole research task. Its model
  // calls and searches finish before billing, even if the balance goes negative.
  if (
    (await isHostedServerAuthMode()) &&
    (await checkUsageCreditsDepleted(customer)).depleted
  )
    throw new AppError(
      "INSUFFICIENT_CREDITS",
      "You need usage credits to research your website.",
    );
  const work = researchWebsite(website, project, { ...customer, projectId });
  // Keep provider work and final settlement alive within the request's
  // background grace period if the client disconnects, as the shared meter does.
  waitUntil(work.catch(() => undefined));
  return work;
}
async function researchAttempt(
  input: {
    projectId: string;
    website: string;
    requestId: string;
    confirmedPaidWork: true;
  },
  customer: BillingCustomerContext,
  options: { actor: CompetitorResearchActor; runSeededTracking?: boolean },
) {
  const work = WebsiteResearchAttemptService.startDirect(
    input,
    customer,
    options,
  );
  waitUntil(work.catch(() => undefined));
  return work;
}
/** Better Auth needs a confirmed stable request; delegated modes run directly. */
async function startResearch(
  input: {
    projectId: string;
    website: string;
    requestId?: string;
    confirmedPaidWork?: true;
  },
  customer: BillingCustomerContext,
  options: { actor: CompetitorResearchActor; runSeededTracking?: boolean },
) {
  if (await usesBetterAuthServer()) {
    const { projectId, website, requestId, confirmedPaidWork } = input;
    if (!requestId || !confirmedPaidWork)
      throw new AppError(
        "VALIDATION_ERROR",
        "A confirmed website research request ID is required.",
      );
    return researchAttempt(
      { projectId, website, requestId, confirmedPaidWork },
      customer,
      options,
    );
  }
  return {
    attemptId: null,
    status: "review_ready" as const,
    review: await research(input.projectId, input.website, customer),
    failure: null,
  };
}
async function save(
  input: SaveProjectWebsiteSetup,
  customer: BillingCustomerContext,
  author: ContextAuthor,
  // In-app onboarding runs seeded tracking once. MCP setup never spends;
  // agents get approval before a run.
  {
    runSeededTracking = false,
    actor,
  }: { runSeededTracking?: boolean; actor?: CompetitorResearchActor } = {},
) {
  const accepted = saveProjectWebsiteSetupSchema.parse(input);
  const project = await requireProject(customer, accepted.projectId);
  const hasReferences = Boolean(
    accepted.websiteResearchAttemptId ||
    accepted.competitorResearchRunId ||
    accepted.competitorResearchContextVersion !== undefined ||
    accepted.competitors.some((row) => row.researchCandidateId),
  );
  if (hasReferences && !accepted.websiteResearchAttemptId)
    throw new AppError("VALIDATION_ERROR");
  const reviewedDomain = normalizeBacklinksTarget(accepted.domain, {
    scope: "domain",
  }).apiTarget;
  const reviewedCompetitors = accepted.competitors.map((row) => ({
    ...row,
    domain: normalizeBacklinksTarget(row.domain, { scope: "domain" }).apiTarget,
  }));
  if (
    hasReferences &&
    new Set(reviewedCompetitors.map((row) => row.domain)).size !==
      reviewedCompetitors.length
  )
    throw new AppError(
      "VALIDATION_ERROR",
      "Each competitor domain can appear only once in a reviewed setup.",
    );
  const reviewed = {
    ...accepted,
    domain: reviewedDomain,
    competitors: reviewedCompetitors,
  };
  const requestHash = hasReferences
    ? await sha256Hex(JSON.stringify([reviewed, runSeededTracking]))
    : null;
  const prepared = hasReferences
    ? await prepareWebsiteSetupEvidence(
        reviewed,
        actor,
        customer.organizationId,
        requestHash!,
        runSeededTracking,
      )
    : null;
  if (prepared?.replayed) return requireProject(customer, accepted.projectId);
  accepted.name = project.name;
  accepted.domain = project.domain ?? reviewedDomain;
  const existing = await ProjectContextRepository.listCompetitors(
    accepted.projectId,
  );
  // A saved competitor list is authoritative, even if it was added while
  // research was running or the review was open. Setup never edits that list.
  if (existing.length) {
    if (prepared && !prepared.replayed && prepared.evidence.run)
      throw new AppError("CONFLICT");
    accepted.competitors = [];
  }
  for (const competitor of accepted.competitors) {
    competitor.domain = normalizeBacklinksTarget(competitor.domain, {
      scope: "domain",
    }).apiTarget;
    if (competitor.domain === accepted.domain)
      throw new AppError(
        "VALIDATION_ERROR",
        "Your own website cannot be a competitor.",
      );
  }
  // Keep one reviewed entry per normalized domain.
  accepted.competitors = [
    ...new Map(accepted.competitors.map((row) => [row.domain, row])).values(),
  ];
  const tracking = await prepareWebsiteTracking(accepted, project);
  try {
    await saveWebsiteSetup(
      customer.organizationId,
      accepted,
      author,
      tracking,
      prepared && !prepared.replayed ? prepared.evidence : undefined,
    );
  } catch (error) {
    if (prepared && requestHash) {
      const current = await prepareWebsiteSetupEvidence(
        reviewed,
        actor,
        customer.organizationId,
        requestHash,
        runSeededTracking,
      );
      if (current.replayed) return requireProject(customer, accepted.projectId);
    }
    throw error;
  }
  if (tracking && runSeededTracking)
    await startWebsiteTrackingRun(accepted.projectId, customer);
  return requireProject(customer, accepted.projectId);
}
export const ProjectWebsiteService = {
  research,
  researchAttempt,
  startResearch,
  getResearch: WebsiteResearchAttemptService.get,
  save,
};
