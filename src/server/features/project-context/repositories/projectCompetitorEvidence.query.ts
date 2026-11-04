import { and, asc, desc, eq, isNotNull, isNull } from "drizzle-orm";
import { db } from "@/db";
import {
  projectCompetitors as competitors,
  projectCompetitorResearchCandidates as candidates,
  projectCompetitorResearchRuns as runs,
} from "@/db/schema";

/** Only the still-linked canonical row may display a source claim. */
export async function listProjectCompetitorEvidence(projectId: string) {
  return db
    .select({
      canonicalId: competitors.id,
      runId: runs.id,
      candidateId: candidates.id,
      sourceUrl: candidates.sourceUrl,
      capturedAtMs: candidates.sourceCapturedAtMs,
      excerpt: candidates.sourceExcerpt,
      method: candidates.extractionMethod,
    })
    .from(competitors)
    .innerJoin(
      candidates,
      and(
        eq(candidates.canonicalCompetitorId, competitors.id),
        eq(candidates.projectId, competitors.projectId),
        eq(candidates.domain, competitors.domain),
        eq(candidates.selected, 1),
        eq(candidates.acceptanceOutcome, "added"),
        isNotNull(candidates.sourceUrl),
        isNotNull(candidates.sourceExcerpt),
        isNotNull(candidates.sourceHash),
        isNotNull(candidates.sourceCapturedAtMs),
        isNotNull(candidates.extractionMethod),
      ),
    )
    .innerJoin(
      runs,
      and(
        eq(runs.id, candidates.runId),
        eq(runs.projectId, candidates.projectId),
        isNull(runs.redactedAtMs),
      ),
    )
    .where(
      and(
        eq(competitors.projectId, projectId),
        eq(candidates.projectId, projectId),
      ),
    );
}

/**
 * Verified competitors from the latest research run that nobody has reviewed
 * and that are not saved to the project. A reviewed run is settled: leaving a
 * candidate out of the review was a decision.
 */
export async function listUnsavedCompetitorCandidates(projectId: string) {
  const [latest] = await db
    .select({ id: runs.id, reviewMutationId: runs.reviewMutationId })
    .from(runs)
    .where(
      and(
        eq(runs.projectId, projectId),
        eq(runs.state, "finished"),
        isNull(runs.redactedAtMs),
      ),
    )
    .orderBy(desc(runs.createdAtMs), desc(runs.id))
    .limit(1);
  if (!latest || latest.reviewMutationId) return [];
  return db
    .select({
      domain: candidates.domain,
      name: candidates.name,
      sourceUrl: candidates.sourceUrl,
      capturedAtMs: candidates.sourceCapturedAtMs,
    })
    .from(candidates)
    .leftJoin(
      competitors,
      and(
        eq(competitors.projectId, candidates.projectId),
        eq(competitors.domain, candidates.domain),
      ),
    )
    .where(
      and(
        eq(candidates.projectId, projectId),
        eq(candidates.runId, latest.id),
        eq(candidates.classification, "verified"),
        isNull(competitors.id),
      ),
    )
    .orderBy(asc(candidates.rankOrder));
}
