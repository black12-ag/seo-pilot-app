import { sha256Hex } from "@/server/lib/audit/ids";
import { normalizeDomainInput } from "@/server/lib/domainUtils";
import { competitorResearchCandidateSchema } from "@/types/schemas/competitorResearch";
import type {
  CompetitorResearchRun,
  CompetitorResearchSnapshot,
} from "@/types/schemas/competitorResearch";
import { projectCompetitorResearchOperations as operations } from "@/db/schema";
import { currentAuthority } from "./competitorResearchOperationWrites";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { runBatch } from "@/db/runBatch";
import {
  projectCompetitorResearchCandidates as candidates,
  projectCompetitorResearchRuns as runs,
  projectCompetitors,
  projects,
} from "@/db/schema";
import { bumpContentContext } from "@/server/features/content/repositories/contentProjectWrites";
import { ContentRepository } from "@/server/features/content/repositories/ContentRepository";
import { ProjectRepository } from "@/server/features/projects/repositories/ProjectRepository";
import { AppError } from "@/server/lib/errors";
import {
  acceptCompetitorResearchInputSchema,
  type AcceptCompetitorResearchInput,
  type AcceptCompetitorResearchResult,
} from "@/types/schemas/competitorResearch";
import type { CompetitorResearchScope } from "./CompetitorResearchRepository";
import { locks } from "./competitorResearchOperationWrites";

async function authorize(scope: CompetitorResearchScope, projectId: string) {
  const [project, member] = await Promise.all([
    ProjectRepository.getProjectForOrganization(
      projectId,
      scope.actor.organizationId,
    ),
    ContentRepository.getMembership(
      scope.actor.organizationId,
      scope.actor.userId,
    ),
  ]);
  if (!project) throw new AppError("NOT_FOUND");
  if (
    !scope.requireMembership ||
    !member ||
    member.id !== scope.memberId ||
    member.role !== scope.actor.role
  )
    throw new AppError("FORBIDDEN");
}
async function reviewResult(
  run: typeof runs.$inferSelect,
  replayed: boolean,
): Promise<AcceptCompetitorResearchResult> {
  if (run.appliedContextVersion === null)
    return { ok: false, code: "conflict", currentContextVersion: null };
  const selected = await db
    .select()
    .from(candidates)
    .where(
      and(
        eq(candidates.runId, run.id),
        eq(candidates.projectId, run.projectId),
        eq(candidates.selected, 1),
      ),
    );
  const rows: Extract<AcceptCompetitorResearchResult, { ok: true }>["rows"] =
    selected.flatMap((row) =>
      row.acceptanceOutcome === "added" ||
      row.acceptanceOutcome === "already_saved"
        ? [
            {
              candidateId: row.id,
              domain: row.domain,
              outcome:
                row.acceptanceOutcome === "added"
                  ? ("added" as const)
                  : ("already_saved" as const),
            },
          ]
        : [],
    );
  return {
    ok: true,
    runId: run.id,
    replayed,
    appliedContextVersion: run.appliedContextVersion,
    rows,
  };
}
async function accept(
  scope: CompetitorResearchScope,
  input: AcceptCompetitorResearchInput,
  requestHash: string,
  nowMs: number,
): Promise<AcceptCompetitorResearchResult> {
  if (
    !acceptCompetitorResearchInputSchema.safeParse(input).success ||
    !/^[a-f0-9]{64}$/.test(requestHash)
  )
    throw new AppError("VALIDATION_ERROR");
  await authorize(scope, input.projectId);
  const [run] = await db
    .select()
    .from(runs)
    .where(
      and(
        eq(runs.id, input.runId),
        eq(runs.projectId, input.projectId),
        eq(runs.organizationId, scope.actor.organizationId),
      ),
    )
    .limit(1);
  if (!run) throw new AppError("NOT_FOUND");
  if (run.redactedAtMs !== null)
    return { ok: false, code: "privacy_erased", currentContextVersion: null };
  if (
    run.sponsorUserId !== scope.actor.userId ||
    run.sponsorMemberId !== scope.memberId ||
    run.sponsorRole !== scope.actor.role
  )
    return { ok: false, code: "sponsor_changed", currentContextVersion: null };
  if (run.reviewMutationId) {
    if (
      run.reviewMutationId === input.mutationId &&
      run.reviewRequestHash === requestHash
    )
      return reviewResult(run, true);
    return { ok: false, code: "conflict", currentContextVersion: null };
  }
  if (
    run.state !== "finished" ||
    !["complete", "partial", "unknown"].includes(run.outcome ?? "")
  )
    return { ok: false, code: "run_not_ready", currentContextVersion: null };
  const rows = await db
    .select()
    .from(candidates)
    .where(
      and(
        eq(candidates.projectId, input.projectId),
        eq(candidates.runId, input.runId),
      ),
    );
  const selections = input.selections.map((selection) => ({
    selection,
    candidate: rows.find((row) => row.id === selection.candidateId),
    canonicalId: crypto.randomUUID(),
  }));
  if (
    selections.some(
      ({ candidate }) =>
        !candidate ||
        candidate.classification !== "verified" ||
        !candidate.sourceUrl ||
        !candidate.sourceExcerpt ||
        !candidate.sourceHash ||
        candidate.sourceCapturedAtMs === null ||
        candidate.domain === run.domain,
    )
  )
    return { ok: false, code: "conflict", currentContextVersion: null };
  const reviewToken = crypto.randomUUID();
  const timestamp = new Date(nowMs).toISOString();
  const memberGuard = sql`exists (select 1 from projects p join member m on m.organization_id=p.organization_id where p.id=${input.projectId} and p.organization_id=${scope.actor.organizationId} and p.archived_at is null and coalesce(p.domain,'')=coalesce(${run.domain},'') and p.location_code=${run.locationCode} and p.language_code=${run.languageCode} and m.id=${scope.memberId} and m.user_id=${scope.actor.userId} and m.role=${scope.actor.role})`;
  const versionGuard = sql`coalesce((select s.context_version from content_project_state s where s.project_id=${input.projectId}),0)=${input.expectedContextVersion} and ${run.contextVersion}=${input.expectedContextVersion}`;
  const candidateGuards = selections.map(
    ({ candidate }) =>
      sql`exists (select 1 from project_competitor_research_candidates c where c.id=${candidate!.id} and c.project_id=${input.projectId} and c.run_id=${input.runId} and c.domain=${candidate!.domain} and c.classification='verified' and c.source_url is not null and c.source_excerpt is not null and c.source_hash is not null and c.source_captured_at_ms is not null)`,
  );
  const newCount = selections.map(
    ({ candidate }) =>
      sql`(case when exists (select 1 from project_competitors p where p.project_id=${input.projectId} and p.domain=${candidate!.domain}) then 0 else 1 end)`,
  );
  const valid = sql`${memberGuard} and ${versionGuard} and ${candidateGuards.length ? sql.join(candidateGuards, sql` and `) : sql`true`} and (select count(*) from project_competitors p where p.project_id=${input.projectId}) + ${newCount.length ? sql.join(newCount, sql` + `) : sql`0`} <= 100`;
  const receipt = sql`exists (select 1 from project_competitor_research_runs r where r.id=${run.id} and r.project_id=${input.projectId} and r.review_mutation_id=${input.mutationId} and r.review_request_hash=${requestHash} and r.review_token=${reviewToken} and r.redacted_at_ms is null)`;
  const added = sql`exists (select 1 from project_competitor_research_candidates c where c.run_id=${run.id} and c.project_id=${input.projectId} and c.selected=1 and c.acceptance_outcome='added')`;
  await runBatch((tx) => [
    ...locks(tx, run),
    tx
      .update(runs)
      .set({
        reviewMutationId: input.mutationId,
        reviewToken,
        reviewRequestHash: requestHash,
        reviewedAtMs: nowMs,
        reviewedByUserId: scope.actor.userId,
      })
      .where(
        and(
          eq(runs.id, run.id),
          sql`${runs.reviewMutationId} is null and ${runs.state}='finished' and ${runs.redactedAtMs} is null and not exists (select 1 from project_competitor_research_runs other where other.project_id=${input.projectId} and other.review_mutation_id=${input.mutationId}) and ${valid}`,
        ),
      ),
    ...selections.flatMap(({ selection, candidate, canonicalId }) => [
      tx
        .insert(projectCompetitors)
        .select(
          sql`select ${canonicalId}, ${input.projectId}, ${candidate!.domain}, ${selection.name}, ${selection.notes}, ${timestamp}, ${scope.actor.surface === "web" ? "user" : scope.actor.surface} where ${receipt} and ${memberGuard}`,
        )
        .onConflictDoNothing(),
      tx
        .update(candidates)
        .set({
          selected: 1,
          acceptedName: selection.name,
          acceptedNotes: selection.notes,
          acceptanceOutcome: sql`case when exists (select 1 from project_competitors p where p.id=${canonicalId} and p.project_id=${input.projectId} and p.domain=${candidate!.domain}) then 'added' else 'already_saved' end`,
          canonicalCompetitorId: sql`case when exists (select 1 from project_competitors p where p.id=${canonicalId} and p.project_id=${input.projectId} and p.domain=${candidate!.domain}) then ${canonicalId} else null end`,
          canonicalInsertedAt: sql`case when exists (select 1 from project_competitors p where p.id=${canonicalId} and p.project_id=${input.projectId} and p.domain=${candidate!.domain}) then ${timestamp} else null end`,
        })
        .where(
          and(
            eq(candidates.id, candidate!.id),
            eq(candidates.runId, run.id),
            receipt,
            memberGuard,
          ),
        ),
    ]),
    bumpContentContext(
      tx,
      input.projectId,
      sql`${receipt} and ${memberGuard} and ${added}`,
    ),
    tx
      .update(runs)
      .set({
        appliedContextVersion: sql`coalesce((select s.context_version from content_project_state s where s.project_id=${input.projectId}),0)`,
      })
      .where(and(eq(runs.id, run.id), receipt, memberGuard)),
    tx
      .update(projects)
      .set({ name: sql`null` })
      .where(
        and(
          eq(projects.id, input.projectId),
          receipt,
          sql`not (${memberGuard})`,
        ),
      ),
  ]);
  await authorize(scope, input.projectId);
  const [after] = await db
    .select()
    .from(runs)
    .where(and(eq(runs.id, run.id), eq(runs.projectId, input.projectId)))
    .limit(1);
  if (after?.redactedAtMs !== null)
    return { ok: false, code: "privacy_erased", currentContextVersion: null };
  if (
    after?.reviewMutationId === input.mutationId &&
    after.reviewRequestHash === requestHash
  )
    return reviewResult(after, after.reviewToken !== reviewToken);
  const currentContextVersion = await ContentRepository.getContextVersion(
    scope.actor.organizationId,
    input.projectId,
  );
  return {
    ok: false,
    code:
      currentContextVersion !== input.expectedContextVersion
        ? "context_changed"
        : "conflict",
    currentContextVersion,
  };
}
async function recordSetupEvidence(
  scope: CompetitorResearchScope,
  input: {
    runId: string;
    snapshot: CompetitorResearchSnapshot;
    candidates: CompetitorResearchRun["candidates"];
    outcome:
      | "complete"
      | "partial"
      | "unavailable"
      | "failed"
      | "blocked"
      | "unknown";
    nowMs: number;
  },
) {
  const [run] = await db
    .select()
    .from(runs)
    .where(
      and(
        eq(runs.id, input.runId),
        eq(runs.organizationId, scope.actor.organizationId),
      ),
    )
    .limit(1);
  if (!run) throw new AppError("NOT_FOUND");
  await authorize(scope, run.projectId);
  if (run.redactedAtMs !== null) return { kind: "blocked" } as const;
  if (
    run.sponsorUserId !== scope.actor.userId ||
    run.sponsorMemberId !== scope.memberId ||
    run.sponsorRole !== scope.actor.role ||
    run.origin !== "setup"
  )
    return { kind: "blocked" } as const;
  if (run.state === "finished") return { kind: "stored" } as const;
  if (
    run.contextHash !== input.snapshot.contextHash ||
    run.contextVersion !== input.snapshot.contextVersion ||
    run.domain !== input.snapshot.domain ||
    run.locationCode !== input.snapshot.locationCode ||
    run.languageCode !== input.snapshot.languageCode ||
    input.candidates.length > 5
  )
    return { kind: "blocked" } as const;
  const domains = new Set<string>();
  const candidateIds = new Set<string>();
  for (const candidate of input.candidates) {
    if (
      !competitorResearchCandidateSchema.safeParse(candidate).success ||
      candidate.extractionMethod !== "legacy_read_site" ||
      domains.has(candidate.domain) ||
      candidateIds.has(candidate.id)
    )
      return { kind: "blocked" } as const;
    try {
      const url = new URL(candidate.source.url);
      if (
        normalizeDomainInput(url.hostname, true) !== candidate.domain ||
        normalizeDomainInput(candidate.domain, true) !== candidate.domain ||
        (run.domain !== null &&
          candidate.domain === normalizeDomainInput(run.domain, true)) ||
        (await sha256Hex(candidate.source.excerpt)) !==
          candidate.source.textHash
      )
        return { kind: "blocked" } as const;
    } catch {
      return { kind: "blocked" } as const;
    }
    domains.add(candidate.domain);
    candidateIds.add(candidate.id);
  }
  const guard = currentAuthority(run, input.nowMs);
  const opId = crypto.randomUUID();
  const inputHash = await sha256Hex(JSON.stringify(input.candidates));
  await runBatch((tx) => [
    ...locks(tx, run),
    ...input.candidates.map((candidate, rank) =>
      tx
        .insert(candidates)
        .select(
          sql`select ${candidate.id}, ${run.projectId}, ${run.id}, ${candidate.domain}, ${rank}, null, ${candidate.source.url}, ${candidate.source.url}, ${candidate.source.excerpt}, ${candidate.source.textHash}, ${candidate.source.capturedAtMs}, 'legacy_read_site', null, ${candidate.partialEvidence ? 1 : 0}, 'verified', ${candidate.name}, ${candidate.notes}, 0, null, null, null, null, null where ${guard}`,
        )
        .onConflictDoNothing(),
    ),
    tx
      .insert(operations)
      .select(
        sql`select ${opId}, ${run.projectId}, ${run.id}, 'setup_evidence', 'legacy', 'succeeded', null, ${inputHash}, null, null, null, null, ${input.nowMs}, null, null, null, null, 'unknown', null, null, null where ${guard}`,
      )
      .onConflictDoNothing(),
    tx
      .update(projects)
      .set({ name: sql`null` })
      .where(
        and(
          eq(projects.id, run.projectId),
          sql`exists (select 1 from project_competitor_research_operations o where o.id=${opId}) and (select count(*) from project_competitor_research_candidates c where c.run_id=${run.id}) <> ${input.candidates.length}`,
        ),
      ),
    tx
      .update(runs)
      .set({
        state: "finished",
        outcome: input.outcome,
        finishedAtMs: input.nowMs,
        activeProjectId: null,
        revokedAtMs: input.nowMs,
      })
      .where(
        and(
          eq(runs.id, run.id),
          guard,
          sql`exists (select 1 from project_competitor_research_operations o where o.id=${opId} and o.run_id=${run.id})`,
        ),
      ),
  ]);
  const [after] = await db
    .select()
    .from(runs)
    .where(eq(runs.id, run.id))
    .limit(1);
  return after?.state === "finished" &&
    after.redactedAtMs === null &&
    after.outcome === input.outcome
    ? ({ kind: "stored" } as const)
    : ({ kind: "blocked" } as const);
}
export { accept, recordSetupEvidence };
