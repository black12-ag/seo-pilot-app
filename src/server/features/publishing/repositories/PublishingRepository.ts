import { and, desc, eq, inArray, sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { wordpressConnections, wordpressPublishRecords } from "@/db/schema";
import {
  authorityScope,
  type AuthorityScope,
} from "@/server/features/site-authority/repositories/siteAuthorityProjectWrites";
import type { PublishState, WordPressGrant } from "@/types/schemas/publishing";

const connections = wordpressConnections;
const records = wordpressPublishRecords;
export type PublishRecordRow = typeof records.$inferSelect;
export type WordPressConnectionRow = typeof connections.$inferSelect;

function inOrganization(organizationId: string, projectId: string): SQL {
  return sql`exists (select 1 from projects p where p.id = ${projectId} and p.organization_id = ${organizationId} and p.archived_at is null)`;
}

function authorityHeld(
  scope: AuthorityScope,
  projectId: string,
  origin: string,
  nowMs: number,
): SQL {
  return sql`${authorityScope(scope, projectId)}
    and exists (select 1 from project_site_authority a where a.project_id = ${projectId} and a.status = 'verified' and a.origin = ${origin} and a.verified_until_ms > ${nowMs})`;
}

// Runs inside the statement that admits the write, so a role, authority or
// grant change right up to that moment refuses it.
function writeAllowed(
  scope: AuthorityScope,
  projectId: string,
  origin: string,
  nowMs: number,
): SQL {
  return sql`${authorityHeld(scope, projectId, origin, nowMs)}
    and exists (select 1 from wordpress_connections c where c.project_id = ${projectId} and c.origin = ${origin} and c.read_status = 'granted' and c.write_status = 'granted')`;
}

/** The review that allowed this send, as the eligibility check last read it. */
export type HeldApproval = {
  requestId: string;
  requestVersion: number;
  headVersion: number;
};

// A withdrawal, new review, new revision, archive or erasure refuses the write.
function approvalHeld(
  projectId: string,
  contentId: string,
  revisionId: string,
  approval: HeldApproval,
): SQL {
  return sql`exists (select 1 from content_review_requests q
    join content_items i on i.project_id = q.project_id and i.id = q.content_id
    join content_revisions v on v.project_id = q.project_id and v.id = q.revision_id
    where q.id = ${approval.requestId} and q.project_id = ${projectId} and q.content_id = ${contentId} and q.revision_id = ${revisionId}
    and q.version = ${approval.requestVersion} and q.state = 'approved' and q.sequence = i.review_version
    and i.head_version = ${approval.headVersion} and i.archived_at_ms is null
    and v.redacted_at_ms is null)`;
}

async function getConnection(organizationId: string, projectId: string) {
  const [row] = await db
    .select()
    .from(connections)
    .where(
      and(
        eq(connections.projectId, projectId),
        inOrganization(organizationId, projectId),
      ),
    )
    .limit(1);
  return row ?? null;
}

/**
 * Whether this exact password may still go to its site right now. A grant check
 * is how read access gets established, so only it passes `needsRead: false`.
 * Anything that changes the site passes `needsWrite`, the same test as admission.
 */
async function credentialUsable(
  scope: AuthorityScope,
  input: {
    projectId: string;
    credentialId: string;
    origin: string;
    needsRead: boolean;
    needsWrite: boolean;
    nowMs: number;
  },
) {
  const { projectId, credentialId, origin, needsRead, needsWrite, nowMs } =
    input;
  const rows = await db
    .select({ projectId: connections.projectId })
    .from(connections)
    .where(
      and(
        eq(connections.projectId, projectId),
        eq(connections.credentialId, credentialId),
        eq(connections.origin, origin),
        needsRead || needsWrite
          ? eq(connections.readStatus, "granted")
          : undefined,
        needsWrite ? eq(connections.writeStatus, "granted") : undefined,
        authorityHeld(scope, projectId, origin, nowMs),
      ),
    )
    .limit(1);
  return rows.length === 1;
}

/** A new password starts unchecked, whatever the old one was allowed to do. */
async function saveConnection(
  scope: AuthorityScope,
  input: {
    projectId: string;
    origin: string;
    credentialId: string;
    sealedCredential: string;
    nowMs: number;
  },
) {
  const { projectId, origin, credentialId, sealedCredential, nowMs } = input;
  const rows = await db
    .insert(connections)
    .select(
      sql`select ${projectId}, ${origin}, ${credentialId}, ${sealedCredential}, 'unchecked', 'unchecked', null, null, ${scope.userId}, ${nowMs}, ${nowMs}
        where ${authorityScope(scope, projectId)}
        and exists (select 1 from project_site_authority a where a.project_id = ${projectId} and a.status = 'verified' and a.origin = ${origin} and a.verified_until_ms > ${nowMs})`,
    )
    .onConflictDoUpdate({
      target: connections.projectId,
      set: {
        origin,
        credentialId,
        sealedCredential,
        readStatus: "unchecked",
        writeStatus: "unchecked",
        readCheckedAtMs: null,
        writeCheckedAtMs: null,
        createdByUserId: scope.userId,
        updatedAtMs: nowMs,
      },
    })
    .returning({ projectId: connections.projectId });
  return rows.length === 1;
}

const grantFields = (grant: WordPressGrant) =>
  grant === "read"
    ? ({ status: "readStatus", checkedAt: "readCheckedAtMs" } as const)
    : ({ status: "writeStatus", checkedAt: "writeCheckedAtMs" } as const);

// The time only ever moves forward, even within one millisecond or on a clock
// running behind, so a grant's status and time together work as its version.
function grantColumns(
  grant: WordPressGrant,
  status: WordPressConnectionRow["readStatus"],
  nowMs: number,
) {
  const fields = grantFields(grant);
  const checkedAt = connections[fields.checkedAt];
  return {
    [fields.status]: status,
    [fields.checkedAt]: sql<number>`case when ${checkedAt} >= ${nowMs} then ${checkedAt} + 1 else ${nowMs} end`,
    updatedAtMs: nowMs,
  };
}

/**
 * Stores a test's result only if the grant is still as it was read before the
 * test began. A revoke, a newer result or a new password in between drops it, so
 * a slow site can't undo a person's decision.
 */
async function recordGrantCheck(
  scope: AuthorityScope,
  input: {
    connection: WordPressConnectionRow;
    grant: WordPressGrant;
    status: WordPressConnectionRow["readStatus"];
    nowMs: number;
  },
) {
  const { connection, grant } = input;
  const { projectId, credentialId } = connection;
  const { status, checkedAt } = grantFields(grant);
  const rows = await db
    .update(connections)
    .set(grantColumns(grant, input.status, input.nowMs))
    .where(
      and(
        eq(connections.projectId, projectId),
        eq(connections.credentialId, credentialId),
        eq(connections[status], connection[status]),
        sql`coalesce(${connections[checkedAt]}, -1) = ${connection[checkedAt] ?? -1}`,
        // Testing write access requires read access, right up to the result.
        grant === "write" ? eq(connections.readStatus, "granted") : undefined,
        authorityScope(scope, projectId),
      ),
    )
    .returning({ projectId: connections.projectId });
  return rows.length === 1;
}

async function revokeGrant(
  scope: AuthorityScope,
  input: { projectId: string; grant: WordPressGrant; nowMs: number },
) {
  await db
    .update(connections)
    .set(grantColumns(input.grant, "revoked", input.nowMs))
    .where(
      and(
        eq(connections.projectId, input.projectId),
        authorityScope(scope, input.projectId),
      ),
    );
}

async function deleteConnection(scope: AuthorityScope, projectId: string) {
  await db
    .delete(connections)
    .where(
      and(
        eq(connections.projectId, projectId),
        authorityScope(scope, projectId),
      ),
    );
}

async function listRecords(organizationId: string, projectId: string) {
  return db
    .select()
    .from(records)
    .where(
      and(
        eq(records.projectId, projectId),
        inOrganization(organizationId, projectId),
      ),
    )
    .orderBy(desc(records.createdAtMs), desc(records.id))
    .limit(100);
}

async function getRecord(
  organizationId: string,
  projectId: string,
  recordId: string,
) {
  const [row] = await db
    .select()
    .from(records)
    .where(
      and(
        eq(records.id, recordId),
        eq(records.projectId, projectId),
        inOrganization(organizationId, projectId),
      ),
    )
    .limit(1);
  return row ?? null;
}

async function getRecordByKey(
  organizationId: string,
  projectId: string,
  idempotencyKey: string,
) {
  const [row] = await db
    .select()
    .from(records)
    .where(
      and(
        eq(records.projectId, projectId),
        eq(records.idempotencyKey, idempotencyKey),
        inOrganization(organizationId, projectId),
      ),
    )
    .limit(1);
  return row ?? null;
}

/**
 * Stores the write-once record before any request leaves. Returns null when the
 * caller may not write or another request already holds this key.
 */
async function admitRecord(
  scope: AuthorityScope,
  input: {
    id: string;
    projectId: string;
    contentId: string;
    revisionId: string;
    idempotencyKey: string;
    origin: string;
    title: string;
    slug: string;
    contentHash: string;
    approval: HeldApproval;
    nowMs: number;
  },
) {
  const { id, projectId, contentId, revisionId, idempotencyKey } = input;
  const { origin, title, slug, contentHash, approval, nowMs } = input;
  const [row] = await db
    .insert(records)
    .select(
      sql`select ${id}, ${projectId}, ${contentId}, ${revisionId}, ${idempotencyKey}, ${origin}, ${title}, ${slug}, ${contentHash}, 'sending', 1, ${nowMs}, null, null, null, null, null, null, null, null, null, ${scope.userId}, ${nowMs}, ${nowMs}
        where ${writeAllowed(scope, projectId, origin, nowMs)}
        and ${approvalHeld(projectId, contentId, revisionId, approval)}`,
    )
    .onConflictDoNothing()
    .returning();
  return row ?? null;
}

/** Takes a failed or absent attempt back to sending. Only one caller can win. */
async function claimRetry(
  scope: AuthorityScope,
  record: PublishRecordRow,
  draft: { title: string; slug: string; contentHash: string },
  approval: HeldApproval,
  nowMs: number,
) {
  const [row] = await db
    .update(records)
    .set({
      ...draft,
      state: "sending",
      attempt: sql`${records.attempt} + 1`,
      lastAttemptAtMs: nowMs,
      failureCode: null,
      updatedAtMs: nowMs,
    })
    .where(
      and(
        eq(records.id, record.id),
        eq(records.projectId, record.projectId),
        eq(records.attempt, record.attempt),
        inArray(records.state, ["failed", "not_found"]),
        writeAllowed(scope, record.projectId, record.origin, nowMs),
        approvalHeld(
          record.projectId,
          record.contentId,
          record.revisionId,
          approval,
        ),
      ),
    )
    .returning();
  return row ?? null;
}

/** The baseline must be what we sent. An erased record has no baseline to compare. */
async function claimTrash(
  scope: AuthorityScope,
  record: PublishRecordRow,
  nowMs: number,
) {
  const [row] = await db
    .update(records)
    .set({
      state: "trashing",
      lastAttemptAtMs: nowMs,
      failureCode: null,
      updatedAtMs: nowMs,
    })
    .where(
      and(
        eq(records.id, record.id),
        eq(records.projectId, record.projectId),
        eq(records.attempt, record.attempt),
        inArray(records.state, ["verified", "mismatch"]),
        eq(records.remoteContentHash, records.contentHash),
        writeAllowed(scope, record.projectId, record.origin, nowMs),
      ),
    )
    .returning();
  return row ?? null;
}

/**
 * Stores what happened on the site. It has no role check on purpose: a request
 * already sent must still be recorded if the sender lost access meanwhile. The
 * caller read `record` before a slow request, so a newer attempt wins. A row
 * erased during that request keeps its empty content hash and gains no baseline.
 */
async function settleRecord(
  organizationId: string,
  record: PublishRecordRow,
  from: PublishState[],
  patch: Partial<
    Pick<
      PublishRecordRow,
      | "state"
      | "failureCode"
      | "mismatchFields"
      | "remotePostId"
      | "remoteRevisionId"
      | "remoteModifiedGmt"
      | "remoteStatus"
      | "remoteContentHash"
      | "verifiedAtMs"
      | "trashedAtMs"
    >
  >,
  nowMs: number,
) {
  const [row] = await db
    .update(records)
    .set({
      ...patch,
      ...(patch.remoteContentHash === undefined
        ? {}
        : {
            remoteContentHash: sql`case when ${records.contentHash} = '' then null else ${patch.remoteContentHash} end`,
          }),
      updatedAtMs: nowMs,
    })
    .where(
      and(
        eq(records.id, record.id),
        eq(records.projectId, record.projectId),
        eq(records.attempt, record.attempt),
        inArray(records.state, from),
        sql`exists (select 1 from projects p where p.id = ${record.projectId} and p.organization_id = ${organizationId})`,
      ),
    )
    .returning();
  return row ?? null;
}

export const PublishingRepository = {
  getConnection,
  credentialUsable,
  saveConnection,
  recordGrantCheck,
  revokeGrant,
  deleteConnection,
  listRecords,
  getRecord,
  getRecordByKey,
  admitRecord,
  claimRetry,
  claimTrash,
  settleRecord,
} as const;
