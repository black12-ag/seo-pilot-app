import { symmetricDecrypt, symmetricEncrypt } from "better-auth/crypto";
import { z } from "zod";
import { getOptionalEnvValue } from "@/server/lib/runtime-env";
import { MIN_BETTER_AUTH_SECRET_LENGTH } from "@/shared/selfhost-checks";

const sealedSchema = z.strictObject({
  username: z.string(),
  applicationPassword: z.string(),
  projectId: z.string(),
  origin: z.string(),
});

// The main worker already holds this secret for stored OAuth tokens. The suffix
// keeps these ciphertexts from opening anywhere else that secret is used.
async function readKey() {
  const secret = (await getOptionalEnvValue("BETTER_AUTH_SECRET"))?.trim();
  return secret && secret.length >= MIN_BETTER_AUTH_SECRET_LENGTH
    ? `${secret}:wordpress-credential-v1`
    : null;
}

export async function canSealWordPressCredential() {
  return (await readKey()) !== null;
}

/** The sealed value names its project and site, so a copied row cannot be replayed. */
export async function sealWordPressCredential(input: {
  username: string;
  applicationPassword: string;
  projectId: string;
  origin: string;
}) {
  const key = await readKey();
  if (!key) throw new Error("Encryption key is not set");
  return symmetricEncrypt({ key, data: JSON.stringify(input) });
}

/** Decrypts in memory only. The result must never be persisted, logged or returned. */
export async function openWordPressCredential(
  sealed: string,
  expected: { projectId: string; origin: string },
) {
  const key = await readKey();
  if (!key) return null;
  try {
    const parsed = sealedSchema.parse(
      JSON.parse(await symmetricDecrypt({ key, data: sealed })),
    );
    if (
      parsed.projectId !== expected.projectId ||
      parsed.origin !== expected.origin
    )
      return null;
    return {
      origin: parsed.origin,
      username: parsed.username,
      applicationPassword: parsed.applicationPassword,
    };
  } catch {
    return null;
  }
}
