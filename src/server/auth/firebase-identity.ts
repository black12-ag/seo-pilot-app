import { env } from "cloudflare:workers";
import { APIError } from "better-auth/api";
import { symmetricDecrypt, symmetricEncrypt } from "better-auth/crypto";
import { getAuthMode } from "@/lib/auth-mode";
import { FirebaseIdentityRepository as repository } from "./repositories/FirebaseIdentityRepository";
import { verifyFirebaseToken } from "./firebase-token";
import {
  firebaseProofSchema,
  type FirebasePublicConfig,
  type VerifiedFirebaseIdentity,
} from "@/shared/firebase-auth";

export async function isFirebaseBoundUser(userId: string) {
  return (
    getAuthMode(env.AUTH_MODE) === "password" && repository.isBound(userId)
  );
}

export async function resolveFirebaseUser(identity: VerifiedFirebaseIdentity) {
  const existing = await repository.findIdentity(
    identity.firebaseProjectId,
    identity.firebaseUid,
  );
  if (existing) return existing.user;
  const sameEmail = await repository.findUserByEmail(identity.email);
  if (sameEmail) {
    // The token is accepted only for a Google sign-in with a verified email,
    // so an account with the same email links itself on first Google sign-in.
    if (!(await repository.isBound(sameEmail.id))) {
      try {
        await repository.link(sameEmail.id, identity);
      } catch {
        // A concurrent sign-in may have linked it first; checked below.
      }
    }
    const linked = await repository.findIdentity(
      identity.firebaseProjectId,
      identity.firebaseUid,
    );
    if (linked?.user.id === sameEmail.id) return linked.user;
    throw new APIError("CONFLICT", {
      code: "FIREBASE_IDENTITY_CONFLICT",
      message: "This account already has a different Google identity linked.",
    });
  }
  try {
    const created = await repository.provisionInvited(identity);
    if (created) return created.user;
  } catch {
    // Concurrent successful provisioning of this UID is safe to reuse.
    const winner = await repository.findIdentity(
      identity.firebaseProjectId,
      identity.firebaseUid,
    );
    if (winner) return winner.user;
  }
  throw new APIError("FORBIDDEN", {
    code: "FIREBASE_INVITATION_REQUIRED",
    message: "A current invitation for your Google email address is required.",
  });
}

export async function linkFirebaseIdentity(
  userId: string,
  email: string,
  identity: VerifiedFirebaseIdentity,
  sessionId: string,
) {
  if (await repository.getProof(sessionId)) {
    throw new APIError("FORBIDDEN", {
      message: "Sign in with your password before linking Google.",
    });
  }
  if (
    identity.email !== email.trim().toLowerCase() ||
    Date.now() / 1_000 - identity.authTimeSeconds > 300
  ) {
    throw new APIError("FORBIDDEN", {
      message:
        "Use the same verified email and sign in to Google again before linking.",
    });
  }
  const existing = await repository.findIdentity(
    identity.firebaseProjectId,
    identity.firebaseUid,
  );
  if (existing?.user.id === userId) return;
  if (!existing) {
    try {
      await repository.link(userId, identity);
      return;
    } catch {
      const winner = await repository.findIdentity(
        identity.firebaseProjectId,
        identity.firebaseUid,
      );
      if (winner?.user.id === userId) return;
    }
  }
  throw new APIError("CONFLICT", {
    message: "This account already has a different Google identity linked.",
  });
}

export async function saveFirebaseSessionProof(input: {
  sessionId: string;
  userId: string;
  idToken: string;
  identity: VerifiedFirebaseIdentity;
  secret: string;
}) {
  const { identity } = input;
  const envelope = firebaseProofSchema.parse({
    v: 1,
    sessionId: input.sessionId,
    userId: input.userId,
    projectId: identity.firebaseProjectId,
    firebaseUid: identity.firebaseUid,
    idToken: input.idToken,
    authTime: identity.authTimeSeconds,
    tokenExpiresAt: identity.tokenExpiresAtMs,
  });
  await repository.insertProof({
    sessionId: input.sessionId,
    userId: input.userId,
    firebaseProjectId: identity.firebaseProjectId,
    firebaseUid: identity.firebaseUid,
    encryptedProof: await symmetricEncrypt({
      key: input.secret,
      data: JSON.stringify(envelope),
    }),
    authTimeSeconds: identity.authTimeSeconds,
    tokenExpiresAtMs: identity.tokenExpiresAtMs,
    createdAtMs: Date.now(),
  });
}

// Returns false only for an ordinary password session; invalid proofs throw.
export async function validateFirebaseSession(input: {
  sessionId: string;
  userId: string;
  expiresAt: Date;
  config: FirebasePublicConfig | null;
  secret: string;
}) {
  const record = await repository.getProof(input.sessionId);
  if (!record) return false;
  try {
    const { proof, identityUserId, sessionUserId } = record;
    if (
      !input.config ||
      proof.userId !== input.userId ||
      identityUserId !== input.userId ||
      sessionUserId !== input.userId
    )
      throw new Error("Proof owner mismatch");
    const envelope = firebaseProofSchema.parse(
      JSON.parse(
        await symmetricDecrypt({
          key: input.secret,
          data: proof.encryptedProof,
        }),
      ),
    );
    if (
      envelope.sessionId !== input.sessionId ||
      envelope.userId !== input.userId ||
      envelope.projectId !== proof.firebaseProjectId ||
      envelope.firebaseUid !== proof.firebaseUid ||
      envelope.authTime !== proof.authTimeSeconds ||
      envelope.tokenExpiresAt !== proof.tokenExpiresAtMs ||
      proof.firebaseProjectId !== input.config.projectId ||
      proof.tokenExpiresAtMs <= Date.now() ||
      input.expiresAt.getTime() > proof.tokenExpiresAtMs
    )
      throw new Error("Proof binding mismatch");
    const identity = await verifyFirebaseToken(envelope.idToken, input.config);
    const verifiedAt = Date.now();
    if (
      identity.firebaseUid !== proof.firebaseUid ||
      identity.firebaseProjectId !== proof.firebaseProjectId ||
      identity.authTimeSeconds !== proof.authTimeSeconds ||
      identity.tokenExpiresAtMs !== proof.tokenExpiresAtMs ||
      proof.tokenExpiresAtMs <= verifiedAt ||
      input.expiresAt.getTime() <= verifiedAt
    )
      throw new Error("Proof identity mismatch");
    return true;
  } catch {
    throw new APIError("UNAUTHORIZED", {
      message: "Your Google session has expired. Please sign in again.",
    });
  }
}
