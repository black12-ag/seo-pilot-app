import { normalizeBacklinksTarget } from "@/server/lib/dataforseoBacklinksTarget";

export const SC_DOMAIN_PREFIX = "sc-domain:";

/**
 * The project domain a Search Console property stands for: a domain property
 * (`sc-domain:example.com`) is its bare domain, a URL-prefix property
 * (`https://www.example.com/blog/`) its host. Both go through the rule a
 * project's own domain is saved with, so the two compare equal.
 */
export function propertyDomain(siteUrl: string): string | null {
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
  return normalizeSiteDomain(host);
}

/** A host or domain as a project's own domain is saved, or null if invalid. */
export function normalizeSiteDomain(domain: string): string | null {
  try {
    return normalizeBacklinksTarget(domain, { scope: "domain" }).apiTarget;
  } catch {
    return null;
  }
}
