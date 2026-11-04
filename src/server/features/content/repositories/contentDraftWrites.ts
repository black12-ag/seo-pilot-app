import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { runBatch } from "@/db/runBatch";
import { contentMutations, projects } from "@/db/schema";
import { lockProject } from "@/server/features/site-authority/repositories/siteAuthorityProjectWrites";
import {
  contentWriteGuard,
  lockContentMembership,
  type ContentWriteScope,
} from "./contentRevisionWrites";

const DRAFT_KIND = "generate";

async function getDraftClaim(
  organizationId: string,
  projectId: string,
  mutationId: string,
) {
  const [row] = await db
    .select({
      id: contentMutations.id,
      kind: contentMutations.kind,
      requestHash: contentMutations.requestHash,
      resultId: contentMutations.resultId,
      completed: contentMutations.completed,
      createdAtMs: contentMutations.createdAtMs,
    })
    .from(contentMutations)
    .innerJoin(projects, eq(projects.id, contentMutations.projectId))
    .where(
      and(
        eq(contentMutations.projectId, projectId),
        eq(contentMutations.mutationId, mutationId),
        eq(projects.organizationId, organizationId),
        isNull(projects.archivedAt),
      ),
    )
    .limit(1);
  return row ?? null;
}

/**
 * Takes the one durable right to call the model for this request ID, before
 * any paid work. Refused when the head moved or another draft of the same
 * content is still inside its time window.
 */
async function claimDraft(
  scope: ContentWriteScope,
  input: {
    projectId: string;
    contentId: string;
    mutationId: string;
    requestHash: string;
    expectedHeadVersion: number;
    nowMs: number;
    liveAfterMs: number;
  },
) {
  const { projectId, contentId, mutationId, requestHash, nowMs } = input;
  const receiptId = crypto.randomUUID();
  const guard = contentWriteGuard(scope, projectId);
  const head = sql`exists (select 1 from content_items i where i.project_id = ${projectId} and i.id = ${contentId} and i.archived_at_ms is null and i.head_version = ${input.expectedHeadVersion})`;
  const idle = sql`not exists (select 1 from content_mutations m where m.project_id = ${projectId} and m.kind = ${DRAFT_KIND} and m.result_id = ${contentId} and m.completed = 0 and m.created_at_ms > ${input.liveAfterMs})`;
  await runBatch((tx) => [
    lockProject(tx, projectId, scope.actor.organizationId),
    ...lockContentMembership(tx, scope, projectId),
    tx
      .insert(contentMutations)
      .select(
        sql`select ${receiptId}, ${projectId}, ${mutationId}, ${requestHash}, ${DRAFT_KIND}, ${contentId}, 0, ${nowMs} where ${guard} and ${head} and ${idle}`,
      )
      .onConflictDoNothing(),
  ]);
  const claim = await getDraftClaim(
    scope.actor.organizationId,
    projectId,
    mutationId,
  );
  return { claimed: claim?.id === receiptId, claim };
}

/** Records how a claimed request ended. `resultId` is a revision or a reason. */
async function finishDraft(
  scope: ContentWriteScope,
  input: {
    projectId: string;
    mutationId: string;
    requestHash: string;
    resultId: string;
  },
) {
  await db
    .update(contentMutations)
    .set({ completed: 1, resultId: input.resultId })
    .where(
      and(
        eq(contentMutations.projectId, input.projectId),
        eq(contentMutations.mutationId, input.mutationId),
        eq(contentMutations.requestHash, input.requestHash),
        eq(contentMutations.kind, DRAFT_KIND),
        eq(contentMutations.completed, 0),
        contentWriteGuard(scope, input.projectId),
      ),
    );
}

export const ContentDraftRepository = {
  DRAFT_KIND,
  getDraftClaim,
  claimDraft,
  finishDraft,
} as const;
