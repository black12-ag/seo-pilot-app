import type { BetterAuthPlugin } from "better-auth";
import {
  APIError,
  createAuthEndpoint,
  createAuthMiddleware,
  formCsrfMiddleware,
  getAuthoritativeSessionFromCtx,
  getShouldSkipSessionRefresh,
  setShouldSkipSessionRefresh,
} from "better-auth/api";
import { deleteSessionCookie, setSessionCookie } from "better-auth/cookies";
import {
  getFirebaseConfig,
  verifyFirebaseToken,
} from "@/server/auth/firebase-token";
import {
  linkFirebaseIdentity,
  resolveFirebaseUser,
  saveFirebaseSessionProof,
  validateFirebaseSession,
} from "@/server/auth/firebase-identity";
import {
  firebaseLinkSchema,
  firebaseSignInSchema,
} from "@/shared/firebase-auth";

// The app invokes this BEFORE its own API-key/session hook: configured hooks
// precede plugin hooks in Better Auth 1.6.22's dispatcher.
export async function guardFirebaseSession(
  ctx: Parameters<typeof getAuthoritativeSessionFromCtx>[0],
) {
  if (
    [
      "/sign-in/firebase",
      "/sign-in/email",
      "/sign-up/email",
      "/sign-out",
    ].includes(ctx.path ?? "")
  )
    return;

  if (!ctx.headers?.has("cookie")) return;
  const previous = await getShouldSkipSessionRefresh();
  await setShouldSkipSessionRefresh(true);
  const current = await getAuthoritativeSessionFromCtx(ctx);
  if (!current) {
    await setShouldSkipSessionRefresh(previous);
    return;
  }
  try {
    if (current.session.userId !== current.user.id)
      throw new APIError("UNAUTHORIZED");
    const firebase = await validateFirebaseSession({
      sessionId: current.session.id,
      userId: current.user.id,
      expiresAt: current.session.expiresAt,
      config: getFirebaseConfig(),
      secret: ctx.context.secret,
    });
    if (!firebase) await setShouldSkipSessionRefresh(previous);
  } catch {
    await ctx.context.internalAdapter.deleteSession(current.session.token);
    deleteSessionCookie(ctx);
    throw new APIError("UNAUTHORIZED", {
      message: "Google session is no longer valid. Please sign in again.",
    });
  }
}

export function createFirebaseAuthPlugin(
  verifyPassword: (headers: Headers, password: string) => Promise<unknown>,
) {
  const sameOrigin = createAuthMiddleware(async (ctx) => {
    const origin = ctx.headers?.get("origin");
    if (
      origin !== new URL(ctx.context.baseURL).origin ||
      !ctx.headers?.get("content-type")?.startsWith("application/json")
    ) {
      throw new APIError("FORBIDDEN", {
        message: "A same-origin JSON request is required.",
      });
    }
  });
  return {
    id: "firebase-identity",
    endpoints: {
      signInFirebase: createAuthEndpoint(
        "/sign-in/firebase",
        {
          method: "POST",
          body: firebaseSignInSchema,
          use: [sameOrigin, formCsrfMiddleware],
          requireHeaders: true,
        },
        async (ctx) => {
          const config = getFirebaseConfig();
          if (!config) throw new APIError("NOT_FOUND");
          const identity = await verifyFirebaseToken(ctx.body.idToken, config);
          const user = await resolveFirebaseUser(identity);
          const session = await ctx.context.internalAdapter.createSession(
            user.id,
            false,
            { expiresAt: new Date(identity.tokenExpiresAtMs) },
            true,
          );
          if (!session) throw new APIError("INTERNAL_SERVER_ERROR");
          try {
            await saveFirebaseSessionProof({
              sessionId: session.id,
              userId: user.id,
              idToken: ctx.body.idToken,
              identity,
              secret: ctx.context.secret,
            });
            const remaining = Math.floor(
              (identity.tokenExpiresAtMs - Date.now()) / 1_000,
            );
            if (remaining <= 0) throw new Error("Expired identity");
            await setSessionCookie(ctx, { session, user }, false, {
              maxAge: remaining,
              expires: session.expiresAt,
            });
          } catch {
            await ctx.context.internalAdapter.deleteSession(session.token);
            throw new APIError("INTERNAL_SERVER_ERROR", {
              message: "Unable to create Google session.",
            });
          }
          return ctx.json({ status: "ok" as const });
        },
      ),
      linkFirebase: createAuthEndpoint(
        "/link/firebase",
        {
          method: "POST",
          body: firebaseLinkSchema,
          use: [sameOrigin, formCsrfMiddleware],
          requireHeaders: true,
        },
        async (ctx) => {
          const config = getFirebaseConfig();
          if (!config) throw new APIError("NOT_FOUND");
          await setShouldSkipSessionRefresh(true);
          const current = await getAuthoritativeSessionFromCtx(ctx);
          if (!current) throw new APIError("UNAUTHORIZED");
          await verifyPassword(ctx.headers, ctx.body.password);
          const identity = await verifyFirebaseToken(ctx.body.idToken, config);
          await linkFirebaseIdentity(
            current.user.id,
            current.user.email,
            identity,
            current.session.id,
          );
          return ctx.json({ status: "ok" as const });
        },
      ),
    },
  } satisfies BetterAuthPlugin;
}
