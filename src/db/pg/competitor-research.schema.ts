import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  integer,
  pgTable,
  text,
  uniqueIndex,
  doublePrecision,
  bigint,
} from "drizzle-orm/pg-core";
import { projects } from "./app.schema";
import { organization, user } from "./better-auth-schema";
import { projectCompetitors } from "./project-context.schema";

export const projectCompetitorResearchRuns = pgTable(
  "project_competitor_research_runs",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    admissionToken: text("admission_token").notNull(),
    requestId: text("request_id").notNull(),
    requestHash: text("request_hash").notNull(),
    origin: text("origin").notNull(),
    state: text("state").notNull(),
    outcome: text("outcome"),
    reason: text("reason"),
    activeProjectId: text("active_project_id"),
    sponsorUserId: text("sponsor_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    sponsorMemberId: text("sponsor_member_id"),
    sponsorRole: text("sponsor_role"),
    surface: text("surface").notNull(),
    modelBackendId: text("model_backend_id"),
    modelConfigurationHash: text("model_configuration_hash").notNull(),
    domain: text("domain"),
    locationCode: integer("location_code").notNull(),
    languageCode: text("language_code").notNull(),
    contextVersion: bigint("context_version", { mode: "number" }).notNull(),
    contextHash: text("context_hash").notNull(),
    businessSummary: text("business_summary").notNull(),
    ownSourceUrl: text("own_source_url"),
    ownSourceHash: text("own_source_hash"),
    ownSourceCapturedAtMs: bigint("own_source_captured_at_ms", {
      mode: "number",
    }),
    limitsProfile: text("limits_profile"),
    createdAtMs: bigint("created_at_ms", { mode: "number" }).notNull(),
    startedAtMs: bigint("started_at_ms", { mode: "number" }),
    deadlineAtMs: bigint("deadline_at_ms", { mode: "number" }).notNull(),
    finishedAtMs: bigint("finished_at_ms", { mode: "number" }),
    workflowObservedAtMs: bigint("workflow_observed_at_ms", { mode: "number" }),
    revokedAtMs: bigint("revoked_at_ms", { mode: "number" }),
    redactedAtMs: bigint("redacted_at_ms", { mode: "number" }),
    billingState: text("billing_state").notNull(),
    billingToken: text("billing_token"),
    reviewMutationId: text("review_mutation_id"),
    reviewToken: text("review_token"),
    reviewRequestHash: text("review_request_hash"),
    reviewedAtMs: bigint("reviewed_at_ms", { mode: "number" }),
    reviewedByUserId: text("reviewed_by_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    appliedContextVersion: bigint("applied_context_version", {
      mode: "number",
    }),
  },
  (t) => [
    uniqueIndex("competitor_runs_request_uidx").on(t.projectId, t.requestId),
    uniqueIndex("competitor_runs_scope_uidx").on(t.projectId, t.id),
    uniqueIndex("competitor_runs_active_uidx").on(t.activeProjectId),
    uniqueIndex("competitor_runs_review_uidx").on(
      t.projectId,
      t.reviewMutationId,
    ),
    index("competitor_runs_recent_idx").on(t.projectId, t.createdAtMs, t.id),
    check(
      "competitor_runs_origin_check",
      sql`${t.origin} in ('explicit','setup')`,
    ),
    check(
      "competitor_runs_surface_check",
      sql`${t.surface} in ('web','mcp','sam')`,
    ),
    check(
      "competitor_runs_state_check",
      sql`(${t.state} in ('queued','running') and ${t.outcome} is null and ${t.finishedAtMs} is null and ${t.activeProjectId} is not null and ${t.activeProjectId} = ${t.projectId}) or (${t.state} = 'finished' and ${t.outcome} is not null and ${t.outcome} in ('complete','partial','unavailable','failed','blocked','unknown') and ${t.finishedAtMs} is not null and ${t.activeProjectId} is null)`,
    ),
    check(
      "competitor_runs_reason_check",
      sql`${t.reason} is null or ${t.reason} in ('project_domain_missing','dataforseo_not_configured','model_not_configured','unsupported_background_authority','model_not_authorized','insufficient_credits','context_changed','project_changed','sponsor_changed','provider_unavailable','website_unreadable','invalid_model_output','evidence_rejected','deadline','launch_unconfirmed','operation_outcome_unknown','privacy_erased','restored')`,
    ),
    check(
      "competitor_runs_profile_check",
      sql`(${t.origin}='explicit' and ${t.limitsProfile} is not null and ${t.limitsProfile}='competitor-discovery-v1') or (${t.origin}='setup' and ${t.limitsProfile} is null)`,
    ),
    check(
      "competitor_runs_billing_check",
      sql`${t.billingState} in ('not_started','started','submitted','selfhost_external','unknown')`,
    ),
    check(
      "competitor_runs_numbers_check",
      sql`${t.contextVersion} >= 0 and ${t.locationCode} > 0 and ${t.createdAtMs} >= 0 and ${t.deadlineAtMs} >= 0 and (${t.startedAtMs} is null or ${t.startedAtMs} >= 0) and (${t.finishedAtMs} is null or ${t.finishedAtMs} >= 0) and (${t.appliedContextVersion} is null or ${t.appliedContextVersion} >= 0)`,
    ),
  ],
);

export const projectCompetitorResearchOperations = pgTable(
  "project_competitor_research_operations",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id").notNull(),
    runId: text("run_id").notNull(),
    slot: text("slot").notNull(),
    kind: text("kind").notNull(),
    state: text("state").notNull(),
    issueToken: text("issue_token"),
    inputHash: text("input_hash"),
    queryText: text("query_text"),
    targetUrl: text("target_url"),
    candidateId: text("candidate_id"),
    issuedAtMs: bigint("issued_at_ms", { mode: "number" }),
    finishedAtMs: bigint("finished_at_ms", { mode: "number" }),
    reason: text("reason"),
    provider: text("provider"),
    providerTaskId: text("provider_task_id"),
    backendModelId: text("backend_model_id"),
    usageBasis: text("usage_basis").notNull(),
    costUsd: doublePrecision("cost_usd"),
    inputTokens: bigint("input_tokens", { mode: "number" }),
    outputTokens: bigint("output_tokens", { mode: "number" }),
  },
  (t) => [
    uniqueIndex("competitor_ops_slot_uidx").on(t.runId, t.slot),
    uniqueIndex("competitor_ops_scope_uidx").on(t.projectId, t.id),
    foreignKey({
      columns: [t.projectId, t.runId],
      foreignColumns: [
        projectCompetitorResearchRuns.projectId,
        projectCompetitorResearchRuns.id,
      ],
    }).onDelete("cascade"),
    check(
      "competitor_ops_slot_check",
      sql`${t.slot} in ('own_page','search_0','search_1','page_0','page_1','page_2','page_3','page_4','classify','setup_evidence')`,
    ),
    check(
      "competitor_ops_kind_check",
      sql`${t.kind} in ('page','search','model','legacy')`,
    ),
    check(
      "competitor_ops_state_check",
      sql`${t.state} in ('prepared','issued','succeeded','failed','unknown')`,
    ),
    check(
      "competitor_ops_reason_check",
      sql`${t.reason} is null or ${t.reason} in ('project_domain_missing','dataforseo_not_configured','model_not_configured','unsupported_background_authority','model_not_authorized','insufficient_credits','context_changed','project_changed','sponsor_changed','provider_unavailable','website_unreadable','invalid_model_output','evidence_rejected','deadline','launch_unconfirmed','operation_outcome_unknown','privacy_erased','restored')`,
    ),
    check(
      "competitor_ops_receipt_check",
      sql`(${t.state}='prepared' and ${t.issuedAtMs} is null and ${t.finishedAtMs} is null and ${t.issueToken} is null) or (${t.state}='issued' and ${t.issuedAtMs} is not null and ${t.finishedAtMs} is null and ${t.issueToken} is not null and ${t.inputHash} is not null) or (${t.state} in ('succeeded','failed','unknown') and ${t.finishedAtMs} is not null and ((${t.kind}='legacy' and ${t.issuedAtMs} is null) or (${t.issuedAtMs} is not null and ${t.issueToken} is not null)))`,
    ),
    check(
      "competitor_ops_basis_check",
      sql`${t.usageBasis} in ('usd','quota','unknown')`,
    ),
    check(
      "competitor_ops_provider_check",
      sql`${t.provider} is null or ${t.provider} in ('dataforseo','openrouter','owner_worker','public_fetch')`,
    ),
    check(
      "competitor_ops_numbers_check",
      sql`(${t.costUsd} is null or (${t.costUsd} >= 0 and ${t.costUsd} < 1e308)) and (${t.inputTokens} is null or ${t.inputTokens} between 0 and 9007199254740991) and (${t.outputTokens} is null or ${t.outputTokens} between 0 and 9007199254740991) and (${t.issuedAtMs} is null or ${t.issuedAtMs} >= 0) and (${t.finishedAtMs} is null or ${t.finishedAtMs} >= 0)`,
    ),
  ],
);

export const projectCompetitorResearchCandidates = pgTable(
  "project_competitor_research_candidates",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id").notNull(),
    runId: text("run_id").notNull(),
    domain: text("domain").notNull(),
    rankOrder: integer("rank_order").notNull(),
    searchSlot: text("search_slot"),
    requestedUrl: text("requested_url"),
    sourceUrl: text("source_url"),
    sourceExcerpt: text("source_excerpt"),
    sourceHash: text("source_hash"),
    sourceCapturedAtMs: bigint("source_captured_at_ms", { mode: "number" }),
    extractionMethod: text("extraction_method"),
    extractionReason: text("extraction_reason"),
    partialEvidence: integer("partial_evidence").notNull().default(0),
    classification: text("classification").notNull(),
    name: text("name"),
    rationale: text("rationale"),
    selected: integer("selected").notNull().default(0),
    acceptedName: text("accepted_name"),
    acceptedNotes: text("accepted_notes"),
    acceptanceOutcome: text("acceptance_outcome"),
    canonicalCompetitorId: text("canonical_competitor_id").references(
      () => projectCompetitors.id,
      { onDelete: "set null" },
    ),
    canonicalInsertedAt: text("canonical_inserted_at"),
  },
  (t) => [
    uniqueIndex("competitor_candidates_domain_uidx").on(t.runId, t.domain),
    uniqueIndex("competitor_candidates_scope_uidx").on(
      t.projectId,
      t.runId,
      t.id,
    ),
    foreignKey({
      columns: [t.projectId, t.runId],
      foreignColumns: [
        projectCompetitorResearchRuns.projectId,
        projectCompetitorResearchRuns.id,
      ],
    }).onDelete("cascade"),
    check(
      "competitor_candidates_rank_check",
      sql`${t.rankOrder} between 0 and 4`,
    ),
    check(
      "competitor_candidates_class_check",
      sql`${t.classification} in ('pending','verified','not_competitor','unreadable','invalid')`,
    ),
    check(
      "competitor_candidates_bool_check",
      sql`${t.selected} in (0,1) and ${t.partialEvidence} in (0,1)`,
    ),
    check(
      "competitor_candidates_outcome_check",
      sql`${t.acceptanceOutcome} is null or ${t.acceptanceOutcome} in ('added','already_saved')`,
    ),
    check(
      "competitor_candidates_extraction_check",
      sql`${t.extractionMethod} is null or ${t.extractionMethod} in ('public_html_text','public_plain_text','legacy_read_site')`,
    ),
    check(
      "competitor_candidates_slot_check",
      sql`${t.searchSlot} is null or ${t.searchSlot} in ('search_0','search_1')`,
    ),
    check(
      "competitor_candidates_time_check",
      sql`${t.sourceCapturedAtMs} is null or ${t.sourceCapturedAtMs} >= 0`,
    ),
  ],
);
