import { getDomain } from "tldts";
import { normalizeDomain } from "@/types/schemas/domain";
import { isValidDomainHost } from "@/shared/researchScope";
import {
  freeBacklinkReferrersSchema,
  type FreeBacklinksResult,
  type FreeBacklinksSelected,
  type FreeBacklinksTracked,
} from "@/types/schemas/freeBacklinks";
import {
  FreeBacklinksRepository,
  type FreeBacklinkProfileRow,
} from "@/server/features/backlinks/repositories/FreeBacklinksRepository";

/**
 * The registrable domain the web graph is keyed by (blog.example.co.uk ->
 * example.co.uk), or null for input that isn't a real public domain.
 */
function graphDomainFor(input: string): string | null {
  try {
    const host = normalizeDomain(input);
    if (!isValidDomainHost(host)) return null;
    return getDomain(host, { allowPrivateDomains: false }) ?? null;
  } catch {
    return null;
  }
}

function uniqueGraphDomains(domains: string[]): string[] {
  return [
    ...new Set(
      domains.flatMap((domain) => {
        const graphDomain = graphDomainFor(domain);
        return graphDomain ? [graphDomain] : [];
      }),
    ),
  ];
}

/** The domains the refresh script prepares: every live project site and competitor. */
async function trackedDomains(): Promise<string[]> {
  return uniqueGraphDomains(await FreeBacklinksRepository.listTrackedDomains());
}

function toSelected(row: FreeBacklinkProfileRow): FreeBacklinksSelected {
  const parsed = freeBacklinkReferrersSchema.safeParse(
    JSON.parse(row.referrers),
  );
  return {
    domain: row.domain,
    status: "ready",
    release: row.release,
    publishedAt: row.publishedAt,
    importedAt: row.importedAt,
    referringDomains: row.referringDomains,
    referrers: parsed.success
      ? parsed.data.map(([domain, hosts]) => ({ domain, hosts }))
      : [],
  };
}

/**
 * Free backlink data for one project. Only answers for the project's own site
 * and its competitors, so one organization can't read what another tracks.
 */
async function forProject(
  project: { id: string; domain: string | null },
  target: string | undefined,
): Promise<FreeBacklinksResult> {
  const site = project.domain ? graphDomainFor(project.domain) : null;
  const competitors = uniqueGraphDomains(
    await FreeBacklinksRepository.listProjectCompetitorDomains(project.id),
  ).filter((domain) => domain !== site);
  const roles = new Map<string, FreeBacklinksTracked["role"]>([
    ...(site ? [[site, "site"] as const] : []),
    ...competitors.map((domain) => [domain, "competitor"] as const),
  ]);
  const rows = await FreeBacklinksRepository.getProfiles([...roles.keys()]);
  const byDomain = new Map(rows.map((row) => [row.domain, row]));
  const tracked = [...roles].map(([domain, role]) => ({
    domain,
    role,
    referringDomains: byDomain.get(domain)?.referringDomains ?? null,
  }));

  const asked = target?.trim();
  const wanted = asked ? graphDomainFor(asked) : site;
  let selected: FreeBacklinksSelected | null = null;
  if (asked && !wanted) {
    selected = { domain: asked, status: "not_tracked" };
  } else if (wanted) {
    const row = byDomain.get(wanted);
    selected = !roles.has(wanted)
      ? { domain: wanted, status: "not_tracked" }
      : row
        ? toSelected(row)
        : { domain: wanted, status: "not_prepared" };
  }
  return { tracked, selected };
}

export const FreeBacklinksService = { trackedDomains, forProject };
