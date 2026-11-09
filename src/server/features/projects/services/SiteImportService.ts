import { sortBy } from "remeda";
import { DashboardFirstAuditService } from "@/server/features/dashboard/services/DashboardFirstAuditService";
import { DataRefreshClaimRepository } from "@/server/features/dashboard/repositories/DataRefreshClaimRepository";
import { GscConnectionRepository } from "@/server/features/gsc/repositories/GscConnectionRepository";
import { GscService } from "@/server/features/gsc/services/GscService";
import { ProjectService } from "@/server/features/projects/services/ProjectService";
import type { BillingCustomerContext } from "@/server/billing/subscription";
import { normalizeBacklinksTarget } from "@/server/lib/dataforseoBacklinksTarget";
import { AppError, asAppError } from "@/server/lib/errors";
import { buildCacheKey } from "@/server/lib/r2-cache";

const UNVERIFIED_PERMISSION = "siteUnverifiedUser";
const SC_DOMAIN_PREFIX = "sc-domain:";

type ExistingProject = { id: string; name: string; archived: boolean };

type ImportableSite = {
  accountId: string;
  email: string | null;
  siteUrl: string;
  domain: string;
  verified: boolean;
  existingProject: ExistingProject | null;
};

type InitialAudit = Awaited<
  ReturnType<typeof DashboardFirstAuditService.start>
>;

type SiteImportResult = { siteUrl: string; domain: string } & (
  | { status: "created"; projectId: string; initialAudit: InitialAudit }
  | { status: "exists"; projectId: string }
  | { status: "in_progress" }
  | { status: "failed"; code: string }
);

/**
 * The project domain a Search Console property stands for: a domain property
 * (`sc-domain:example.com`) is its bare domain, a URL-prefix property
 * (`https://www.example.com/blog/`) its host. Both go through the rule a
 * project's own domain is saved with, so the two compare equal.
 */
function propertyDomain(siteUrl: string): string | null {
  let host: string;
  if (siteUrl.startsWith(SC_DOMAIN_PREFIX)) {
    host = siteUrl.slice(SC_DOMAIN_PREFIX.length);
  } else {
    try {
      host = new URL(siteUrl).hostname;
    } catch {
      return null;
    }
  }
  return normalizeDomain(host);
}

function normalizeDomain(domain: string): string | null {
  try {
    return normalizeBacklinksTarget(domain, { scope: "domain" }).apiTarget;
  } catch {
    return null;
  }
}

/** Active and archived projects by domain: an archived one still exists. */
async function existingProjectsByDomain(organizationId: string) {
  const [active, archived] = await Promise.all([
    ProjectService.listProjects(organizationId),
    ProjectService.listArchivedProjects(organizationId),
  ]);
  const byDomain = new Map<string, ExistingProject>();
  for (const [projects, isArchived] of [
    [active, false],
    [archived, true],
  ] as const) {
    for (const project of projects) {
      const domain = project.domain ? normalizeDomain(project.domain) : null;
      if (domain && !byDomain.has(domain))
        byDomain.set(domain, {
          id: project.id,
          name: project.name,
          archived: isArchived,
        });
    }
  }
  return byDomain;
}

// A domain property covers every URL-prefix property of its domain, so it is
// the one to bind when Search Console has both.
function preferProperty(a: ImportableSite, b: ImportableSite) {
  if (a.verified !== b.verified) return a.verified ? a : b;
  const aDomain = a.siteUrl.startsWith(SC_DOMAIN_PREFIX);
  const bDomain = b.siteUrl.startsWith(SC_DOMAIN_PREFIX);
  if (aDomain !== bDomain) return aDomain ? a : b;
  return a;
}

/**
 * Every Search Console property the user's connected Google accounts can see,
 * one row per domain, each marked with the organization's project for that
 * domain when there is one.
 */
async function listImportableSites(input: {
  organizationId: string;
  userId: string;
}) {
  const [siteList, existing] = await Promise.all([
    GscService.listSitesForUserWithGrantStatus(input.userId),
    existingProjectsByDomain(input.organizationId),
  ]);
  const byDomain = new Map<string, ImportableSite>();
  for (const account of siteList.accounts) {
    for (const site of account.sites) {
      const domain = propertyDomain(site.siteUrl);
      if (!domain) continue;
      const candidate: ImportableSite = {
        accountId: account.accountId,
        email: account.email,
        siteUrl: site.siteUrl,
        domain,
        verified: site.permissionLevel !== UNVERIFIED_PERMISSION,
        existingProject: existing.get(domain) ?? null,
      };
      const current = byDomain.get(domain);
      byDomain.set(
        domain,
        current ? preferProperty(current, candidate) : candidate,
      );
    }
  }
  return {
    // One entry per linked Google grant, so none means Connect comes first.
    connected: siteList.accounts.length > 0,
    accounts: siteList.accounts.map((account) => ({
      accountId: account.accountId,
      email: account.email,
      requiresReconnect: account.requiresReconnect,
      propertiesUnavailable: account.propertiesUnavailable,
      apiDisabled: account.apiDisabled,
    })),
    sites: sortBy([...byDomain.values()], (site) => site.domain),
  };
}

/**
 * Checks every requested property against what the user's Google accounts can
 * see right now, before anything is written: the client's list is a request,
 * not proof of access.
 */
async function resolveRequestedSites(
  userId: string,
  requested: Array<{ accountId: string; siteUrl: string }>,
) {
  const { accounts } = await GscService.listSitesForUserWithGrantStatus(userId);
  const resolved = new Map<
    string,
    { accountId: string; email: string | null; siteUrl: string }
  >();
  for (const request of requested) {
    const account = accounts.find((a) => a.accountId === request.accountId);
    const site = account?.sites.find((s) => s.siteUrl === request.siteUrl);
    if (!account || !site) {
      throw new AppError(
        "NOT_FOUND",
        `${request.siteUrl} isn't available on your connected Google account.`,
      );
    }
    if (site.permissionLevel === UNVERIFIED_PERMISSION) {
      throw new AppError(
        "FORBIDDEN",
        `You don't have verified access to ${request.siteUrl}.`,
      );
    }
    const domain = propertyDomain(site.siteUrl);
    if (!domain) {
      throw new AppError(
        "VALIDATION_ERROR",
        `${request.siteUrl} has no domain a project can use.`,
      );
    }
    // Two properties of one domain make one project.
    if (!resolved.has(domain))
      resolved.set(domain, {
        accountId: account.accountId,
        email: account.email,
        siteUrl: site.siteUrl,
      });
  }
  return resolved;
}

/**
 * Creates a project for each requested Search Console property whose domain
 * has no project yet, binds the property to it, and starts its first audit
 * the way the New project dialog does. A per-domain claim keeps two imports
 * running at once from both creating the domain; the domain check under that
 * claim keeps a repeated import from creating it again.
 */
async function importSites(input: {
  customer: BillingCustomerContext;
  sites: Array<{ accountId: string; siteUrl: string }>;
}): Promise<SiteImportResult[]> {
  const { customer } = input;
  const organizationId = customer.organizationId;
  const resolved = await resolveRequestedSites(customer.userId, input.sites);
  const results: SiteImportResult[] = [];

  for (const [domain, site] of resolved) {
    const key = await buildCacheKey("projects:site-import", {
      organizationId,
      domain,
    });
    const token = await DataRefreshClaimRepository.claim(key, organizationId);
    if (!token) {
      results.push({ siteUrl: site.siteUrl, domain, status: "in_progress" });
      continue;
    }
    try {
      const existing = (await existingProjectsByDomain(organizationId)).get(
        domain,
      );
      if (existing) {
        results.push({
          siteUrl: site.siteUrl,
          domain,
          status: "exists",
          projectId: existing.id,
        });
        continue;
      }
      const project = await ProjectService.createProject(organizationId, {
        name: domain,
        domain,
      });
      await GscConnectionRepository.upsert({
        projectId: project.id,
        organizationId,
        siteUrl: site.siteUrl,
        connectedByUserId: customer.userId,
        gscAccountId: site.accountId,
        connectedAccountEmail: site.email,
      });
      const initialAudit = await DashboardFirstAuditService.start(
        project.id,
        project.domain,
        { ...customer, projectId: project.id },
      );
      results.push({
        siteUrl: site.siteUrl,
        domain,
        status: "created",
        projectId: project.id,
        initialAudit,
      });
    } catch (error) {
      console.error("projects:site-import failed", { domain }, error);
      results.push({
        siteUrl: site.siteUrl,
        domain,
        status: "failed",
        code: asAppError(error)?.code ?? "INTERNAL_ERROR",
      });
    } finally {
      await DataRefreshClaimRepository.finish(key, token, 0);
    }
  }
  return results;
}

export const SiteImportService = { listImportableSites, importSites };
