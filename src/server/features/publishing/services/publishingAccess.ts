import { SiteAuthorityRepository } from "@/server/features/site-authority/repositories/SiteAuthorityRepository";
import { siteAuthorityAccess } from "@/server/features/site-authority/services/siteAuthorityAccess";
import { AppError } from "@/server/lib/errors";
import type { ContentActor } from "@/types/schemas/content";
import type { PublishingRefusal } from "@/types/schemas/publishing";
import { PublishingRepository } from "../repositories/PublishingRepository";
import { openWordPressCredential } from "./wordpressCredential";
import {
  wordPressTransportAvailable,
  type WordPressSite,
} from "./wordpressClient";

/** Publishing is a person's decision, so only the signed-in web app can reach it. */
export async function publishingAccess(
  actor: ContentActor,
  projectId: string,
  manage = false,
) {
  if (actor.surface !== "web")
    throw new AppError("FORBIDDEN", "human_web_required");
  return siteAuthorityAccess(actor, projectId, manage);
}

type Access = Awaited<ReturnType<typeof publishingAccess>>;

export async function verifiedOrigin(access: Access, projectId: string) {
  const state = await SiteAuthorityRepository.get(access.scope, projectId);
  const authority = state?.authority;
  const verified =
    authority?.status === "verified" &&
    state?.challenge?.status === "verified" &&
    (authority.verifiedUntilMs ?? 0) > Date.now();
  return { verified, origin: authority?.origin ?? null };
}

/**
 * Everything a request needs before it can leave. The password stays in memory,
 * and is only opened for a verified site and a granted read. `stillAllowed` asks
 * the database again before each request, since the site can be slow to answer.
 */
export async function openConnection(
  access: Access,
  projectId: string,
  { needsRead = true }: { needsRead?: boolean } = {},
): Promise<
  | { refused: PublishingRefusal }
  | {
      connection: NonNullable<
        Awaited<ReturnType<typeof PublishingRepository.getConnection>>
      >;
      site: WordPressSite;
    }
> {
  if (!(await wordPressTransportAvailable()))
    return { refused: "transport_unavailable" };
  const connection = await PublishingRepository.getConnection(
    access.scope.organizationId,
    projectId,
  );
  if (!connection) return { refused: "not_connected" };
  const authority = await verifiedOrigin(access, projectId);
  if (!authority.verified || authority.origin !== connection.origin)
    return { refused: "site_not_verified" };
  if (needsRead && connection.readStatus !== "granted")
    return { refused: "grant_missing" };
  const credential = await openWordPressCredential(
    connection.sealedCredential,
    { projectId, origin: connection.origin },
  );
  if (!credential) return { refused: "credential_unreadable" };
  return {
    connection,
    site: {
      ...credential,
      stillAllowed: () =>
        PublishingRepository.credentialUsable(access.scope, {
          projectId,
          credentialId: connection.credentialId,
          origin: connection.origin,
          needsRead,
          nowMs: Date.now(),
        }),
    },
  };
}
