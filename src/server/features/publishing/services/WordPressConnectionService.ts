import { normalizeAndValidateStartUrl } from "@/server/lib/audit/url-policy";
import type { ContentActor } from "@/types/schemas/content";
import {
  connectWordPressInputSchema,
  publishingProjectInputSchema,
  wordPressGrantInputSchema,
  type ConnectionOutcome,
  type ConnectWordPressInput,
  type PublishingStatus,
  type WordPressConnectionSummary,
  type WordPressGrantInput,
} from "@/types/schemas/publishing";
import {
  PublishingRepository,
  type WordPressConnectionRow,
} from "../repositories/PublishingRepository";
import {
  openConnection,
  publishingAccess,
  verifiedOrigin,
} from "./publishingAccess";
import { publishRecordView } from "./publishRecordView";
import {
  canSealWordPressCredential,
  sealWordPressCredential,
} from "./wordpressCredential";
import {
  accessWithdrawn,
  getCurrentWordPressUser,
  wordPressTransportAvailable,
} from "./wordpressClient";

// Trashing is how a draft gets withdrawn, so both are part of being able to write.
const WRITE_CAPABILITIES = ["edit_posts", "delete_posts"];

const refuse = (reason: string) => ({ status: "refused" as const, reason });

function summary(row: WordPressConnectionRow): WordPressConnectionSummary {
  return {
    origin: row.origin,
    read: { status: row.readStatus, checkedAtMs: row.readCheckedAtMs },
    write: { status: row.writeStatus, checkedAtMs: row.writeCheckedAtMs },
    createdAtMs: row.createdAtMs,
    updatedAtMs: row.updatedAtMs,
  };
}

async function originOf(siteUrl: string) {
  try {
    return new URL(await normalizeAndValidateStartUrl(siteUrl)).origin;
  } catch {
    return null;
  }
}

async function status(
  actor: ContentActor,
  raw: { projectId: string },
): Promise<PublishingStatus> {
  const { projectId } = publishingProjectInputSchema.parse(raw);
  const access = await publishingAccess(actor, projectId);
  const [authority, connection, records, transport, encryption] =
    await Promise.all([
      verifiedOrigin(access, projectId),
      PublishingRepository.getConnection(actor.organizationId, projectId),
      PublishingRepository.listRecords(actor.organizationId, projectId),
      wordPressTransportAvailable(),
      canSealWordPressCredential(),
    ]);
  return {
    canManage: access.canManage,
    transportAvailable: transport,
    encryptionAvailable: encryption,
    authority,
    connection: connection ? summary(connection) : null,
    records: records.map(publishRecordView),
  };
}

/** Stores the password sealed. Nothing is sent until someone runs a check. */
async function connect(
  actor: ContentActor,
  raw: ConnectWordPressInput,
): Promise<ConnectionOutcome> {
  const input = connectWordPressInputSchema.parse(raw);
  const access = await publishingAccess(actor, input.projectId, true);
  if (!(await wordPressTransportAvailable()))
    return refuse("transport_unavailable");
  if (!(await canSealWordPressCredential()))
    return refuse("encryption_unavailable");
  const authority = await verifiedOrigin(access, input.projectId);
  if (!authority.verified || !authority.origin)
    return refuse("site_not_verified");
  if ((await originOf(input.siteUrl)) !== authority.origin)
    return refuse("origin_mismatch");
  const sealedCredential = await sealWordPressCredential({
    username: input.username,
    applicationPassword: input.applicationPassword,
    projectId: input.projectId,
    origin: authority.origin,
  });
  const saved = await PublishingRepository.saveConnection(access.scope, {
    projectId: input.projectId,
    origin: authority.origin,
    credentialId: crypto.randomUUID(),
    sealedCredential,
    nowMs: Date.now(),
  });
  if (!saved) return refuse("site_not_verified");
  const row = await PublishingRepository.getConnection(
    actor.organizationId,
    input.projectId,
  );
  return row
    ? { status: "saved", connection: summary(row) }
    : refuse("not_connected");
}

/**
 * Reads the account from the site and never writes a test post, so a write grant
 * only says the account may write. Each draft is still read back on its own.
 */
async function checkGrant(
  actor: ContentActor,
  raw: WordPressGrantInput,
): Promise<ConnectionOutcome> {
  const input = wordPressGrantInputSchema.parse(raw);
  const access = await publishingAccess(actor, input.projectId, true);
  const opened = await openConnection(access, input.projectId, {
    needsRead: false,
  });
  if ("refused" in opened) return refuse(opened.refused);
  if (input.grant === "write" && opened.connection.readStatus !== "granted")
    return refuse("grant_missing");
  const reply = await getCurrentWordPressUser(opened.site);
  // Nothing was learned, so whatever was known before still stands.
  if (reply.kind === "lost") return refuse("check_failed");
  if (reply.kind === "rejected" && accessWithdrawn(reply))
    return refuse("site_not_verified");
  const allowed =
    reply.kind === "ok" &&
    (input.grant === "read" ||
      WRITE_CAPABILITIES.every(
        (name) => reply.value.capabilities?.[name] === true,
      ));
  const recorded = await PublishingRepository.recordGrantCheck(access.scope, {
    projectId: input.projectId,
    credentialId: opened.connection.credentialId,
    grant: input.grant,
    status: allowed ? "granted" : "failed",
    nowMs: Date.now(),
  });
  if (!recorded) return refuse("check_failed");
  const row = await PublishingRepository.getConnection(
    actor.organizationId,
    input.projectId,
  );
  return row
    ? { status: "saved", connection: summary(row) }
    : refuse("not_connected");
}

async function revokeGrant(actor: ContentActor, raw: WordPressGrantInput) {
  const input = wordPressGrantInputSchema.parse(raw);
  const { scope } = await publishingAccess(actor, input.projectId, true);
  await PublishingRepository.revokeGrant(scope, {
    projectId: input.projectId,
    grant: input.grant,
    nowMs: Date.now(),
  });
  return { ok: true as const };
}

async function disconnect(actor: ContentActor, raw: { projectId: string }) {
  const { projectId } = publishingProjectInputSchema.parse(raw);
  const { scope } = await publishingAccess(actor, projectId, true);
  await PublishingRepository.deleteConnection(scope, projectId);
  return { ok: true as const };
}

export const WordPressConnectionService = {
  status,
  connect,
  checkGrant,
  revokeGrant,
  disconnect,
} as const;
