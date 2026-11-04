import { z } from "zod";
import { domainField } from "@/types/schemas/domain";

export const keywordClustersInputSchema = z
  .object({
    projectId: z.string().uuid(),
    locationCode: z.number().int().positive().optional(),
    languageCode: z.string().min(2).max(8).optional(),
  })
  .refine(
    (input) =>
      (input.locationCode === undefined) === (input.languageCode === undefined),
    { message: "Send both location and language, or neither." },
  );

export const keywordGapSetupInputSchema = z.object({
  projectId: z.string().uuid(),
});

export const keywordGapRunInputSchema = z.object({
  projectId: z.string().uuid(),
  competitors: z.array(domainField).min(1).max(3),
  confirmedPaidWork: z.literal(true),
});
