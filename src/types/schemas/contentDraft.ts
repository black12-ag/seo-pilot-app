import { z } from "zod";

const id = z.string().min(1).max(255);
const version = z.number().int().nonnegative();

export const contentDraftRequestSchema = z.strictObject({
  projectId: id,
  contentId: id,
  requestId: z.string().uuid(),
  expectedHeadVersion: version,
  expectedContextVersion: version,
});
export const generateContentDraftInputSchema = contentDraftRequestSchema.extend(
  { confirmedPaidWork: z.literal(true) },
);
export const contentDraftSetupInputSchema = z.strictObject({ projectId: id });

const statementSchema = z.strictObject({
  text: z.string().max(1000),
  kind: z.enum([
    "product",
    "security",
    "financial",
    "legal",
    "general",
    "opinion",
  ]),
  factual: z.boolean(),
  citations: z
    .array(
      z.strictObject({
        source: z.string().max(10),
        quote: z.string().max(1500),
      }),
    )
    .max(5),
});
/** The only shape accepted back from the model. Anything else is discarded. */
export const contentDraftOutputSchema = z.strictObject({
  title: z.string().max(200),
  description: z.string().max(400),
  sections: z
    .array(
      z.strictObject({
        heading: z.string().max(200),
        blocks: z
          .array(
            z.strictObject({
              format: z.enum(["paragraph", "bullets"]),
              statements: z.array(statementSchema).max(12),
            }),
          )
          .max(12),
      }),
    )
    .max(20),
  openQuestions: z.array(z.string().max(500)).max(20),
  omissions: z.array(z.string().max(500)).max(20),
});

export type ContentDraftRequest = z.infer<typeof contentDraftRequestSchema>;
export type GenerateContentDraftInput = z.infer<
  typeof generateContentDraftInputSchema
>;
export type ContentDraftOutput = z.infer<typeof contentDraftOutputSchema>;
