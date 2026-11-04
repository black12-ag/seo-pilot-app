import { invalidateAuditSchedule } from "@/server/features/audit/repositories/auditScheduleProjectWrites";
import { and, eq, isNull, sql } from "drizzle-orm";
import { chunk } from "remeda";
import { runBatch } from "@/db/runBatch";
import { bumpContentContext } from "@/server/features/content/repositories/contentProjectWrites";
import {
  lockProject,
  invalidateSiteAuthority,
} from "@/server/features/site-authority/repositories/siteAuthorityProjectWrites";
import {
  projects,
  projectContextSections,
  projectCompetitors,
} from "@/db/schema";
import type { SaveProjectWebsiteSetup } from "@/types/schemas/projectWebsite";
import type { ContextAuthor } from "@/types/schemas/projectContext";
import {
  writeConfiguration,
  writeResearchKeywords,
  type ConfigurationRows,
} from "@/server/features/ai-visibility/repositories/aiVisibilityConfigurationRepository";
import {
  websiteSetupEvidenceStatements,
  type WebsiteSetupEvidence,
} from "./websiteSetupEvidenceWrites";
import { db } from "@/db";
import {
  projectWebsiteResearchAttempts as attempts,
  projectCompetitorResearchCandidates as candidates,
} from "@/db/schema";
import { AppError } from "@/server/lib/errors";

export async function saveWebsiteSetup(
  organizationId: string,
  input: SaveProjectWebsiteSetup,
  author: ContextAuthor,
  tracking: ConfigurationRows | null,
  evidence?: WebsiteSetupEvidence,
) {
  const updatedAt = new Date().toISOString();
  const nowMs = Date.now();
  const competitors = input.competitors.map((row) => ({
    ...row,
    id: crypto.randomUUID(),
  }));
  // These literals are server-generated UUIDs, never user input. Inlining
  // them keeps the list guard below D1's bound-parameter limit for 100 rows.
  const insertedIds = sql.raw(competitors.map(({ id }) => `'${id}'`).join(","));
  const sourceChecks = competitors
    .filter((row) => row.researchCandidateId)
    .map(
      (row) =>
        sql`exists (select 1 from project_competitors p join project_competitor_research_candidates c on c.canonical_competitor_id=p.id where p.id=${row.id} and p.project_id=${input.projectId} and p.domain=${row.domain} and c.id=${row.researchCandidateId} and c.selected=1 and c.acceptance_outcome='added')`,
    );
  await runBatch((tx) => {
    const guarded = evidence
      ? websiteSetupEvidenceStatements(
          tx,
          evidence,
          input,
          organizationId,
          nowMs,
        )
      : null;
    return [
      ...(guarded?.before ?? [
        lockProject(tx, input.projectId, organizationId),
      ]),
      bumpContentContext(
        tx,
        input.projectId,
        sql`p.organization_id = ${organizationId} and p.archived_at is null`,
      ),
      ...invalidateSiteAuthority(tx, input.projectId, organizationId, {
        reason: "website_changed",
        nowMs: Date.now(),
        condition: sql`p.archived_at is null and p.domain is null`,
      }),
      ...invalidateAuditSchedule(tx, input.projectId, organizationId, {
        reason: "project_changed",
        nowMs: Date.now(),
        condition: sql`p.archived_at is null and p.domain is null`,
      }),
      tx
        .update(projects)
        .set({
          domain: sql`coalesce(${projects.domain}, ${input.domain})`,
        })
        .where(
          and(
            eq(projects.id, input.projectId),
            eq(projects.organizationId, organizationId),
            isNull(projects.archivedAt),
          ),
        ),
      // Insert-only writes also preserve edits made after the service read.
      tx
        .insert(projectContextSections)
        .values({
          projectId: input.projectId,
          key: "business_overview",
          title: null,
          content: input.overview,
          updatedBy: author,
          updatedAt,
        })
        .onConflictDoNothing(),
      // D1 rejects a compound SELECT with more than 5 terms.
      ...chunk(competitors, 5).map((rows) =>
        tx
          .insert(projectCompetitors)
          .select(
            sql`
          select * from (${sql.join(
            rows.map(
              ({ id, domain, name, notes }) =>
                sql`select ${id}, ${input.projectId}, ${domain}, ${name}, ${notes}, ${updatedAt}, ${author}`,
            ),
            sql` union all `,
          )}) as researched_competitors
          where not exists (
            select 1 from ${projectCompetitors}
            where ${projectCompetitors.projectId} = ${input.projectId}
              and ${projectCompetitors.id} not in (${insertedIds})
          )
        `,
          )
          .onConflictDoNothing(),
      ),
      ...(evidence?.run
        ? competitors.flatMap((row) => {
            const source = row.researchCandidateId
              ? evidence.candidates.get(row.researchCandidateId)
              : null;
            if (!source) return [];
            return [
              tx
                .update(candidates)
                .set({
                  selected: 1,
                  acceptedName: row.name,
                  acceptedNotes: row.notes,
                  acceptanceOutcome: "added",
                  canonicalCompetitorId: row.id,
                  canonicalInsertedAt: updatedAt,
                })
                .where(
                  and(
                    eq(candidates.id, source.id),
                    eq(candidates.projectId, input.projectId),
                    eq(candidates.runId, source.runId),
                    sql`exists (select 1 from project_competitors c where c.id=${row.id} and c.project_id=${input.projectId} and c.domain=${source.domain})`,
                  ),
                ),
            ];
          })
        : []),
      ...(evidence
        ? [
            tx
              .update(projects)
              .set({
                name: sql`case when ${sourceChecks.length ? sql.join(sourceChecks, sql` and `) : sql`true`} then ${projects.name} else null end`,
              })
              .where(eq(projects.id, input.projectId)),
          ]
        : []),
      ...(tracking ? writeConfiguration(tx, tracking) : []),
      // Keyword writes fill an empty field; existing research stays intact.
      ...(input.suggestedTopics?.length
        ? writeResearchKeywords(tx, input.projectId, [
            ...input.suggestedTopics.map((topic) => topic.name),
            ...(input.suggestedKeywords ?? []),
          ])
        : []),
      ...(guarded?.after ?? []),
    ];
  });
  if (evidence) {
    const [saved] = await db
      .select({ saveToken: attempts.saveToken })
      .from(attempts)
      .where(eq(attempts.id, evidence.attempt.id))
      .limit(1);
    if (saved?.saveToken !== evidence.saveToken) throw new AppError("CONFLICT");
  }
  return { applied: true } as const;
}
