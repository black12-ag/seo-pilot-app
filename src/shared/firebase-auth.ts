import { z } from "zod";

export const firebasePublicConfigSchema = z
  .object({
    apiKey: z.string().trim().min(1).max(256),
    authDomain: z.string().trim().min(1).max(253),
    projectId: z
      .string()
      .trim()
      .regex(/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/),
    appId: z.string().trim().min(1).max(256),
  })
  .strict()
  .refine(
    (config) => config.authDomain === `${config.projectId}.firebaseapp.com`,
  );
export type FirebasePublicConfig = z.infer<typeof firebasePublicConfigSchema>;

const idToken = z.string().min(1).max(16_384);
export const firebaseSignInSchema = z.strictObject({ idToken });
export const firebaseLinkSchema = z.strictObject({
  idToken,
  password: z.string().min(1).max(128),
});
export const firebaseResultSchema = z.object({ status: z.literal("ok") });

export type VerifiedFirebaseIdentity = {
  firebaseProjectId: string;
  firebaseUid: string;
  email: string;
  name: string;
  authTimeSeconds: number;
  tokenExpiresAtMs: number;
};

export const firebaseProofSchema = z.strictObject({
  v: z.literal(1),
  sessionId: z.string().min(1),
  userId: z.string().min(1),
  projectId: z.string().min(1),
  firebaseUid: z.string().min(1),
  idToken,
  authTime: z.number().int().nonnegative().safe(),
  tokenExpiresAt: z.number().int().nonnegative().safe(),
});
