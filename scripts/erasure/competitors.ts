import { and, eq, inArray, sql } from "drizzle-orm";
import * as schema from "../../src/db/pg/schema";
import type { Db } from "./inventory";

export async function captureCompetitorErasure(db: Db, userId: string) {
  const competitorRunRows = await db
    .select({ id: schema.projectCompetitorResearchRuns.id })
    .from(schema.projectCompetitorResearchRuns)
    .where(eq(schema.projectCompetitorResearchRuns.sponsorUserId, userId));
  const websiteAttemptRows = await db
    .select({ id: schema.projectWebsiteResearchAttempts.id })
    .from(schema.projectWebsiteResearchAttempts)
    .where(eq(schema.projectWebsiteResearchAttempts.sponsorUserId, userId));
  const ownedCanonicalRows = await db
    .select({ id: schema.projectCompetitors.id })
    .from(schema.projectCompetitorResearchCandidates)
    .innerJoin(
      schema.projectCompetitorResearchRuns,
      and(
        eq(
          schema.projectCompetitorResearchRuns.id,
          schema.projectCompetitorResearchCandidates.runId,
        ),
        eq(
          schema.projectCompetitorResearchRuns.projectId,
          schema.projectCompetitorResearchCandidates.projectId,
        ),
      ),
    )
    .innerJoin(
      schema.projectCompetitors,
      and(
        eq(
          schema.projectCompetitors.id,
          schema.projectCompetitorResearchCandidates.canonicalCompetitorId,
        ),
        eq(
          schema.projectCompetitors.projectId,
          schema.projectCompetitorResearchCandidates.projectId,
        ),
        eq(
          schema.projectCompetitors.domain,
          schema.projectCompetitorResearchCandidates.domain,
        ),
        eq(
          schema.projectCompetitors.updatedAt,
          schema.projectCompetitorResearchCandidates.canonicalInsertedAt,
        ),
        sql`coalesce(${schema.projectCompetitors.name},'')=coalesce(${schema.projectCompetitorResearchCandidates.acceptedName},'')`,
        sql`coalesce(${schema.projectCompetitors.notes},'')=coalesce(${schema.projectCompetitorResearchCandidates.acceptedNotes},'')`,
      ),
    )
    .where(
      and(
        eq(schema.projectCompetitorResearchRuns.sponsorUserId, userId),
        eq(
          schema.projectCompetitorResearchCandidates.acceptanceOutcome,
          "added",
        ),
      ),
    );
  return {
    competitorRunIds: competitorRunRows.map((row) => row.id),
    websiteAttemptIds: websiteAttemptRows.map((row) => row.id),
    removedCanonicalIds: [...new Set(ownedCanonicalRows.map((row) => row.id))],
  };
}

export async function verifyCompetitorErasure(
  db: Db,
  captured: Awaited<ReturnType<typeof captureCompetitorErasure>>,
) {
  const unsafeCompetitorRuns = captured.competitorRunIds.length
    ? await db.$count(
        schema.projectCompetitorResearchRuns,
        and(
          inArray(
            schema.projectCompetitorResearchRuns.id,
            captured.competitorRunIds,
          ),
          sql`redacted_at_ms is null or active_project_id is not null or sponsor_user_id is not null or sponsor_member_id is not null or sponsor_role is not null or business_summary <> '' or request_hash <> '' or own_source_url is not null or billing_token is not null`,
        ),
      )
    : 0;
  const unsafeWebsiteAttempts = captured.websiteAttemptIds.length
    ? await db.$count(
        schema.projectWebsiteResearchAttempts,
        and(
          inArray(
            schema.projectWebsiteResearchAttempts.id,
            captured.websiteAttemptIds,
          ),
          sql`redacted_at_ms is null or active_project_id is not null or sponsor_user_id is not null or sponsor_member_id is not null or sponsor_role is not null or requested_website is not null or requested_domain is not null or review_snapshot_json is not null or execution_token is not null or save_token is not null`,
        ),
      )
    : 0;
  const remainingCompetitorCandidates = captured.competitorRunIds.length
    ? await db.$count(
        schema.projectCompetitorResearchCandidates,
        inArray(
          schema.projectCompetitorResearchCandidates.runId,
          captured.competitorRunIds,
        ),
      )
    : 0;
  const unsafeCompetitorOperations = captured.competitorRunIds.length
    ? await db.$count(
        schema.projectCompetitorResearchOperations,
        and(
          inArray(
            schema.projectCompetitorResearchOperations.runId,
            captured.competitorRunIds,
          ),
          sql`query_text is not null or target_url is not null or input_hash is not null or candidate_id is not null or provider_task_id is not null or backend_model_id is not null`,
        ),
      )
    : 0;
  const remainingOwnedCanonical = captured.removedCanonicalIds.length
    ? await db.$count(
        schema.projectCompetitors,
        inArray(schema.projectCompetitors.id, captured.removedCanonicalIds),
      )
    : 0;
  const result = {
    unsafeCompetitorRuns,
    unsafeWebsiteAttempts,
    remainingCompetitorCandidates,
    unsafeCompetitorOperations,
    remainingOwnedCanonical,
  };
  if (Object.values(result).some(Boolean))
    throw new Error(
      "Postgres verification failed: competitor erasure is incomplete.",
    );
  return result;
}
