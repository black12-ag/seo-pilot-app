import { eq, sql } from "drizzle-orm";
import type { runBatch } from "@/db/runBatch";
import type * as ProviderSchema from "@/db/schema";

type Tx = Parameters<Parameters<typeof runBatch>[0]>[0];
type Tables = Pick<
  typeof ProviderSchema,
  | "projectCompetitorResearchRuns"
  | "projectCompetitorResearchOperations"
  | "projectCompetitorResearchCandidates"
  | "projectWebsiteResearchAttempts"
  | "projectCompetitors"
  | "contentProjectState"
>;

// Node's Postgres operator passes its paired schema/transaction here too.
// Both callers execute these ordered real Drizzle statements atomically.
export function competitorResearchPrivacyQueries(
  tx: Tx,
  tables: Tables,
  userId: string,
  nowMs: number,
  tombstoneToken: string,
) {
  const runs = tables.projectCompetitorResearchRuns;
  const operations = tables.projectCompetitorResearchOperations;
  const candidates = tables.projectCompetitorResearchCandidates;
  const attempts = tables.projectWebsiteResearchAttempts;
  const canonical = tables.projectCompetitors;
  const context = tables.contentProjectState;
  const ownedRuns = sql`select r.id from ${runs} r where r.sponsor_user_id = ${userId}`;
  const untouched = sql`from ${candidates} c
    join ${runs} r on r.id=c.run_id and r.project_id=c.project_id
    join ${canonical} p on p.id=c.canonical_competitor_id and p.project_id=c.project_id
      and p.domain=c.domain and p.updated_at=c.canonical_inserted_at
      and coalesce(p.name,'')=coalesce(c.accepted_name,'')
      and coalesce(p.notes,'')=coalesce(c.accepted_notes,'')
    where r.sponsor_user_id=${userId} and c.acceptance_outcome='added'`;
  return [
    tx
      .insert(context)
      .select(
        sql`select distinct c.project_id,1,cast(${nowMs} as bigint) ${untouched}`,
      )
      .onConflictDoUpdate({
        target: context.projectId,
        set: {
          contextVersion: sql`${context.contextVersion}+1`,
          updatedAtMs: nowMs,
        },
      }),
    tx
      .delete(canonical)
      .where(sql`${canonical.id} in (select p.id ${untouched})`),
    tx.delete(candidates).where(sql`${candidates.runId} in (${ownedRuns})`),
    tx
      .update(operations)
      .set({
        state: sql`case when ${operations.state}='issued' then 'unknown' else ${operations.state} end`,
        finishedAtMs: sql`case when ${operations.state}='issued' then ${nowMs} else ${operations.finishedAtMs} end`,
        issueToken: sql`case when ${operations.issuedAtMs} is not null then ${tombstoneToken} else null end`,
        inputHash: null,
        queryText: null,
        targetUrl: null,
        candidateId: null,
        reason: null,
        provider: null,
        providerTaskId: null,
        backendModelId: null,
        inputTokens: null,
        outputTokens: null,
      })
      .where(sql`${operations.runId} in (${ownedRuns})`),
    tx
      .update(attempts)
      .set({
        state: "unknown",
        activeProjectId: null,
        finishedAtMs: sql`coalesce(${attempts.finishedAtMs},${nowMs})`,
        reason: "privacy_erased",
        redactedAtMs: nowMs,
        sponsorUserId: null,
        sponsorMemberId: null,
        sponsorRole: null,
        requestHash: null,
        admissionToken: tombstoneToken,
        executionToken: null,
        requestedWebsite: null,
        requestedDomain: null,
        snapshotDomain: null,
        languageCode: "",
        contextHash: null,
        reviewSnapshotJson: null,
        reviewHash: null,
        saveToken: null,
        saveRequestHash: null,
        savedAtMs: null,
        appliedContextVersion: null,
      })
      .where(eq(attempts.sponsorUserId, userId)),
    tx
      .update(runs)
      .set({
        state: "finished",
        outcome: "blocked",
        reason: "privacy_erased",
        activeProjectId: null,
        finishedAtMs: sql`coalesce(${runs.finishedAtMs},${nowMs})`,
        revokedAtMs: nowMs,
        redactedAtMs: nowMs,
        sponsorUserId: null,
        sponsorMemberId: null,
        sponsorRole: null,
        requestHash: "",
        admissionToken: tombstoneToken,
        modelBackendId: null,
        modelConfigurationHash: "",
        domain: null,
        languageCode: "",
        contextHash: "",
        businessSummary: "",
        ownSourceUrl: null,
        ownSourceHash: null,
        ownSourceCapturedAtMs: null,
        billingState: sql`case when ${runs.billingState}='started' then 'unknown' else ${runs.billingState} end`,
        billingToken: null,
        reviewMutationId: null,
        reviewToken: null,
        reviewRequestHash: null,
        reviewedByUserId: null,
      })
      .where(eq(runs.sponsorUserId, userId)),
  ];
}
