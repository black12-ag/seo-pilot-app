import { normalizeBacklinksTarget } from "@/server/lib/dataforseoBacklinksTarget";
import { sha256Hex } from "@/server/lib/audit/ids";
import { competitorResearchCandidateSchema } from "@/types/schemas/competitorResearch";
import type { WebsiteResearch } from "@/types/schemas/projectWebsite";

/** Legacy Workflow/model reviews carry no durable source-reference authority. */
export function withoutResearchReferences(
  review: WebsiteResearch,
): WebsiteResearch {
  return {
    name: review.name,
    domain: review.domain,
    overview: review.overview,
    preserveCompetitors: review.preserveCompetitors,
    suggestedTopics: review.suggestedTopics,
    suggestedKeywords: review.suggestedKeywords,
    competitors: review.competitors.map(
      ({ name, domain, notes, sourceUrl }) => ({
        name,
        domain,
        notes,
        sourceUrl,
      }),
    ),
  };
}

export type ReadWebsitePage = {
  url: string;
  title: string | null;
  text: string;
  capturedAtMs: number;
};

function boundedExcerpt(value: string) {
  let result = "";
  for (const character of value.trim()) {
    if (new TextEncoder().encode(result + character).byteLength > 2000) break;
    result += character;
  }
  return result.trim();
}

/** Only pages read in the final model attempt can back a candidate. */
export async function verifiedWebsiteCandidates(
  review: WebsiteResearch,
  pages: ReadonlyMap<string, ReadWebsitePage>,
) {
  const candidates = [];
  const seen = new Set<string>();
  for (const competitor of review.competitors) {
    const page = pages.get(competitor.sourceUrl);
    if (!page || seen.has(competitor.domain)) continue;
    let host: string;
    try {
      const url = new URL(page.url);
      if (
        !["http:", "https:"].includes(url.protocol) ||
        url.username ||
        url.password
      )
        continue;
      host = normalizeBacklinksTarget(url.hostname, {
        scope: "domain",
      }).apiTarget;
    } catch {
      continue;
    }
    if (host !== competitor.domain) continue;
    const excerpt = boundedExcerpt(page.text);
    let rationale = "";
    for (const character of competitor.notes.trim()) {
      if (rationale.length + character.length > 180) break;
      rationale += character;
    }
    if (!excerpt || !rationale) continue;
    const candidate = competitorResearchCandidateSchema.safeParse({
      id: crypto.randomUUID(),
      domain: competitor.domain,
      name: competitor.name,
      // The full original notes remain in the persisted website review.
      notes: rationale,
      source: {
        url: page.url,
        excerpt,
        textHash: await sha256Hex(excerpt),
        capturedAtMs: page.capturedAtMs,
      },
      extractionMethod: "legacy_read_site",
      partialEvidence: false,
    });
    if (!candidate.success) continue;
    candidates.push(candidate.data);
    seen.add(competitor.domain);
  }
  return candidates;
}
