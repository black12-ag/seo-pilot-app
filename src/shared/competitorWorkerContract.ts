import { z } from "zod";
const uuid = z.string().uuid();
const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const utf8 = (max: number) =>
  z
    .string()
    .refine(
      (value) => new TextEncoder().encode(value).byteLength <= max,
      `Must fit ${max} UTF-8 bytes`,
    );
const publicUrl = z
  .string()
  .url()
  .max(2048)
  .refine((value) => {
    const u = new URL(value);
    return (
      ["https:", "http:"].includes(u.protocol) && !u.username && !u.password
    );
  });
export const competitorEvidenceSchema = z.strictObject({
  url: publicUrl,
  excerpt: utf8(2000),
  textHash: z.string().regex(/^[a-f0-9]{64}$/),
  capturedAtMs: count,
});
export const competitorClassificationRequestSchema = z
  .strictObject({
    v: z.literal(1),
    operation: z.literal("classify_competitors"),
    requestId: uuid,
    runId: uuid,
    deadlineAtMs: count,
    business: z.strictObject({
      domain: z.string().min(1).max(255),
      summary: utf8(6000),
      locationCode: z.number().int().positive(),
      languageCode: z.string().min(2).max(8),
    }),
    candidates: z
      .array(
        z.strictObject({
          id: uuid,
          domain: z.string().min(1).max(255),
          evidence: competitorEvidenceSchema,
        }),
      )
      .min(1)
      .max(5),
  })
  .refine(
    (x) => new Set(x.candidates.map((c) => c.id)).size === x.candidates.length,
    "Candidate IDs must be distinct",
  );
export const competitorClassificationOutputSchema = z
  .strictObject({
    selections: z
      .array(
        z.strictObject({
          candidateId: uuid,
          reason: z.string().trim().min(1).max(180),
        }),
      )
      .max(5),
  })
  .refine(
    (x) =>
      new Set(x.selections.map((s) => s.candidateId)).size ===
      x.selections.length,
    "Selected IDs must be distinct",
  );
export const competitorModelUsageSchema = z.strictObject({
  backendId: z.string().min(1).max(80),
  modelId: z.string().min(1).max(160).nullable(),
  basis: z.enum(["usd", "quota", "unknown"]),
  costUsd: z.number().finite().nonnegative().nullable(),
  inputTokens: count.nullable(),
  outputTokens: count.nullable(),
});
export const competitorClassificationResponseSchema = z.discriminatedUnion(
  "status",
  [
    z.strictObject({
      v: z.literal(1),
      operation: z.literal("classify_competitors"),
      requestId: uuid,
      status: z.literal("succeeded"),
      output: competitorClassificationOutputSchema,
      usage: competitorModelUsageSchema,
    }),
    z.strictObject({
      v: z.literal(1),
      operation: z.literal("classify_competitors"),
      requestId: uuid,
      status: z.enum(["unavailable", "unknown"]),
      code: z.enum([
        "auth_required",
        "busy",
        "rate_limited",
        "timeout",
        "invalid_output",
        "unsupported",
        "cancelled",
        "provider_failure",
        "unknown",
      ]),
      usage: competitorModelUsageSchema.nullable(),
    }),
  ],
);
export type CompetitorClassificationRequest = z.infer<
  typeof competitorClassificationRequestSchema
>;
export type CompetitorClassificationResponse = z.infer<
  typeof competitorClassificationResponseSchema
>;
