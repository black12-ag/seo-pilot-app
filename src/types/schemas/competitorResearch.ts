import { z } from "zod";
import {
  competitorEvidenceSchema,
  competitorModelUsageSchema,
} from "@/shared/competitorWorkerContract";
const id = z.string().uuid();
const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const hash = z.string().regex(/^[a-f0-9]{64}$/);
export const competitorResearchReasonSchema = z.enum([
  "project_domain_missing",
  "dataforseo_not_configured",
  "model_not_configured",
  "unsupported_background_authority",
  "model_not_authorized",
  "insufficient_credits",
  "context_changed",
  "project_changed",
  "sponsor_changed",
  "provider_unavailable",
  "website_unreadable",
  "invalid_model_output",
  "evidence_rejected",
  "deadline",
  "launch_unconfirmed",
  "operation_outcome_unknown",
  "privacy_erased",
  "restored",
]);
export const competitorResearchSnapshotSchema = z.strictObject({
  domain: z.string().min(1).max(255).nullable(),
  locationCode: z.number().int().positive(),
  languageCode: z.string().min(2).max(8),
  contextVersion: count,
  contextHash: hash,
});
export const competitorResearchLimitsSchema = z.strictObject({
  profile: z.literal("competitor-discovery-v1"),
  maxQueries: z.literal(2),
  searchDepth: z.literal(10),
  maxCandidateSites: z.literal(5),
  maxPages: z.literal(6),
  maxPublicHttpRequests: z.literal(24),
  maxModelCalls: z.literal(1),
  maxModelRequestBytes: z.literal(32768),
  maxModelOutputJsonBytes: z.literal(16384),
  requestedOutputTokens: z.literal(2000),
  maxRendererAttempts: z.literal(0),
  maxPaidRetries: z.literal(0),
  maxRunDurationMs: z.literal(240000),
});
export const competitorResearchCandidateSchema = z.strictObject({
  id,
  domain: z.string().min(1).max(255),
  name: z.string().min(1).max(120),
  notes: z.string().min(1).max(180),
  source: competitorEvidenceSchema,
  extractionMethod: z.enum([
    "public_html_text",
    "public_plain_text",
    "legacy_read_site",
  ]),
  partialEvidence: z.boolean(),
});
export const competitorResearchRunSchema = z.strictObject({
  id,
  projectId: id,
  origin: z.enum(["explicit", "setup"]),
  state: z.enum(["queued", "running", "finished"]),
  outcome: z
    .enum([
      "complete",
      "partial",
      "unavailable",
      "failed",
      "blocked",
      "unknown",
    ])
    .nullable(),
  reasons: z.array(competitorResearchReasonSchema).max(16),
  snapshot: competitorResearchSnapshotSchema,
  limits: competitorResearchLimitsSchema.nullable(),
  createdAtMs: count,
  startedAtMs: count.nullable(),
  deadlineAtMs: count,
  finishedAtMs: count.nullable(),
  candidates: z.array(competitorResearchCandidateSchema).max(5),
  knownCostUsd: z.number().finite().nonnegative().nullable(),
  costComplete: z.boolean(),
  modelIncludedInSubscription: z.boolean(),
  modelUsage: competitorModelUsageSchema.nullable(),
  billingState: z.enum([
    "not_started",
    "started",
    "submitted",
    "selfhost_external",
    "unknown",
  ]),
  reviewState: z.enum(["open", "reviewed", "erased"]),
  canAccept: z.boolean(),
});
export const getCompetitorResearchInputSchema = z.strictObject({
  projectId: id,
});
export const getCompetitorResearchRunInputSchema = z.strictObject({
  projectId: id,
  runId: id,
});
export const startCompetitorResearchInputSchema = z.strictObject({
  projectId: id,
  requestId: id,
  expectedContextVersion: count,
  contextHash: hash,
  capabilityFingerprint: hash,
  confirmedPaidWork: z.literal(true),
});
export const acceptCompetitorResearchInputSchema = z
  .strictObject({
    projectId: id,
    runId: id,
    mutationId: id,
    expectedContextVersion: count,
    selections: z
      .array(
        z.strictObject({
          candidateId: id,
          name: z.string().trim().min(1).max(120),
          notes: z.string().trim().max(500),
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
export const competitorResearchStateSchema = z.strictObject({
  projectId: id,
  contextVersion: count,
  contextHash: hash,
  capabilityFingerprint: hash,
  ready: z.boolean(),
  blockedReasons: z.array(competitorResearchReasonSchema).max(16),
  model: z.strictObject({
    backendId: z.string().max(80).nullable(),
    configured: z.boolean(),
    authorizedForCaller: z.boolean(),
    usageBasis: z.enum(["usd", "quota", "unknown"]),
    outputTokenLimitSupported: z.boolean(),
  }),
  limits: competitorResearchLimitsSchema,
  activeRunId: id.nullable(),
  recentRuns: z.array(competitorResearchRunSchema).max(10),
});
export const startCompetitorResearchResultSchema = z.discriminatedUnion("ok", [
  z.strictObject({
    ok: z.literal(true),
    replayed: z.boolean(),
    run: competitorResearchRunSchema,
  }),
  z.strictObject({
    ok: z.literal(false),
    code: z.enum([
      "conflict",
      "context_changed",
      "run_in_progress",
      "privacy_erased",
    ]),
    activeRunId: id.nullable(),
    currentContextVersion: count.nullable(),
  }),
]);
export const acceptCompetitorResearchResultSchema = z.discriminatedUnion("ok", [
  z.strictObject({
    ok: z.literal(true),
    runId: id,
    replayed: z.boolean(),
    appliedContextVersion: count,
    rows: z
      .array(
        z.strictObject({
          candidateId: id,
          domain: z.string().min(1).max(255),
          outcome: z.enum(["added", "already_saved"]),
        }),
      )
      .max(5),
  }),
  z.strictObject({
    ok: z.literal(false),
    code: z.enum([
      "conflict",
      "context_changed",
      "project_changed",
      "sponsor_changed",
      "run_not_ready",
      "privacy_erased",
    ]),
    currentContextVersion: count.nullable(),
  }),
]);
export const competitorResearchReadResultSchema = z.discriminatedUnion(
  "state",
  [
    z.strictObject({
      state: z.literal("available"),
      run: competitorResearchRunSchema,
    }),
    z.strictObject({
      state: z.literal("unavailable"),
      runId: id,
      reason: z.literal("privacy_erased"),
    }),
  ],
);
export type CompetitorResearchRun = z.infer<typeof competitorResearchRunSchema>;
export type CompetitorResearchSnapshot = z.infer<
  typeof competitorResearchSnapshotSchema
>;
export type CompetitorResearchState = z.infer<
  typeof competitorResearchStateSchema
>;
export type StartCompetitorResearchInput = z.infer<
  typeof startCompetitorResearchInputSchema
>;
export type StartCompetitorResearchResult = z.infer<
  typeof startCompetitorResearchResultSchema
>;
export type AcceptCompetitorResearchInput = z.infer<
  typeof acceptCompetitorResearchInputSchema
>;
export type AcceptCompetitorResearchResult = z.infer<
  typeof acceptCompetitorResearchResultSchema
>;
export type CompetitorResearchActor = {
  userId: string;
  userEmail: string;
  organizationId: string;
  role: string;
  surface: "web" | "mcp" | "sam";
};
