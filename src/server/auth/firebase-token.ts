import { env } from "cloudflare:workers";
import { APIError } from "better-auth/api";
import { importX509, jwtVerify } from "jose";
import { z } from "zod";
import { getAuthMode } from "@/lib/auth-mode";
import { readBoundedText } from "@/server/lib/read-bounded-text";
import {
  firebasePublicConfigSchema,
  type FirebasePublicConfig,
  type VerifiedFirebaseIdentity,
} from "@/shared/firebase-auth";

const certificatesURL =
  "https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com";
const seconds = z.number().int().nonnegative().max(8_640_000_000_000);
const claimsSchema = z.object({
  sub: z.string().min(1).max(128),
  exp: seconds,
  iat: seconds,
  auth_time: seconds,
  email: z.email(),
  email_verified: z.literal(true),
  name: z.string().max(512).optional(),
  firebase: z.object({
    sign_in_provider: z.literal("google.com"),
    tenant: z.never().optional(),
  }),
});
const statusSchema = z.object({
  users: z
    .array(
      z.object({
        localId: z.string(),
        email: z.email(),
        emailVerified: z.literal(true),
        disabled: z.boolean().default(false),
        validSince: z
          .string()
          .regex(/^(0|[1-9][0-9]*)$/)
          .transform(Number)
          .pipe(seconds)
          .optional(),
        tenantId: z.never().optional(),
      }),
    )
    .length(1),
});
let certificates: { expiresAt: number; keys: Record<string, string> } | null =
  null;

export function getFirebaseConfig(): FirebasePublicConfig | null {
  if (getAuthMode(env.AUTH_MODE) !== "password") return null;
  const parsed = firebasePublicConfigSchema.safeParse({
    apiKey: env.FIREBASE_API_KEY,
    authDomain: env.FIREBASE_AUTH_DOMAIN,
    projectId: env.FIREBASE_PROJECT_ID,
    appId: env.FIREBASE_APP_ID,
  });
  return parsed.success ? parsed.data : null;
}

async function fetchJSON(url: string, init?: RequestInit) {
  const signal = AbortSignal.timeout(5_000);
  const response = await fetch(url, {
    ...init,
    redirect: "error",
    signal,
  });
  if (!response.ok) throw new Error("Firebase verification unavailable");
  const body = await readBoundedText(response, 131_072, signal);
  if (body === null) throw new Error("Firebase response exceeds limit");
  return { response, data: z.unknown().parse(JSON.parse(body)) };
}

async function getCertificates() {
  if (certificates && certificates.expiresAt > Date.now())
    return certificates.keys;
  const { response, data } = await fetchJSON(certificatesURL);
  const keys = z.record(z.string(), z.string().max(16_384)).parse(data);
  const maxAge = response.headers
    .get("cache-control")
    ?.match(/max-age=(\d+)/)?.[1];
  certificates = {
    keys,
    expiresAt: Date.now() + Math.min(Number(maxAge ?? 0), 21_600) * 1_000,
  };
  return keys;
}

// Firebase token validation and live account status are separate checks.
// https://firebase.google.com/docs/auth/admin/verify-id-tokens
// https://firebase.google.com/docs/reference/rest/auth#section-get-account-info
export async function verifyFirebaseToken(
  idToken: string,
  config: FirebasePublicConfig,
): Promise<VerifiedFirebaseIdentity> {
  try {
    const { payload } = await jwtVerify(
      idToken,
      async (header) => {
        if (header.alg !== "RS256" || !header.kid)
          throw new Error("Invalid key");
        const certificate = (await getCertificates())[header.kid];
        if (!certificate) throw new Error("Unknown key");
        return importX509(certificate, "RS256");
      },
      {
        algorithms: ["RS256"],
        issuer: `https://securetoken.google.com/${config.projectId}`,
        audience: config.projectId,
        requiredClaims: ["exp", "iat", "sub", "auth_time"],
      },
    );
    const claims = claimsSchema.parse(payload);
    const now = Date.now() / 1_000;
    if (
      claims.iat > now ||
      claims.auth_time > now ||
      claims.auth_time > claims.iat ||
      claims.exp <= claims.iat ||
      claims.exp - claims.iat > 3_600
    )
      throw new Error("Invalid token time");
    const { data } = await fetchJSON(
      `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(config.apiKey)}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ idToken }),
      },
    );
    const account = statusSchema.parse(data).users[0];
    const email = claims.email.toLowerCase();
    if (
      account.disabled ||
      account.localId !== claims.sub ||
      account.email.toLowerCase() !== email ||
      claims.auth_time < (account.validSince ?? 0) ||
      claims.exp * 1_000 <= Date.now()
    )
      throw new Error("Invalid account status");
    return {
      firebaseProjectId: config.projectId,
      firebaseUid: claims.sub,
      email,
      name: claims.name ?? email.split("@")[0],
      authTimeSeconds: claims.auth_time,
      tokenExpiresAtMs: claims.exp * 1_000,
    };
  } catch {
    // Provider payloads and tokens must never enter logs or error responses.
    throw new APIError("UNAUTHORIZED", {
      code: "FIREBASE_IDENTITY_INVALID",
      message: "Google identity could not be verified. Please sign in again.",
    });
  }
}
