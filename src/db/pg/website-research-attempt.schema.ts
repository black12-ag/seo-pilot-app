import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  foreignKey,
  index,
  integer,
  pgTable,
  text,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { projects } from "./app.schema";
import { organization, user } from "./better-auth-schema";
import { projectCompetitorResearchRuns } from "./competitor-research.schema";

export const projectWebsiteResearchAttempts = pgTable(
  "project_website_research_attempts",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    mode: text("mode").notNull(),
    surface: text("surface").notNull(),
    sponsorUserId: text("sponsor_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    sponsorMemberId: text("sponsor_member_id"),
    sponsorRole: text("sponsor_role"),
    requestHash: text("request_hash"),
    admissionToken: text("admission_token").notNull(),
    executionToken: text("execution_token"),
    requestedWebsite: text("requested_website"),
    requestedDomain: text("requested_domain"),
    snapshotDomain: text("snapshot_domain"),
    locationCode: integer("location_code").notNull(),
    languageCode: text("language_code").notNull(),
    contextVersion: bigint("context_version", { mode: "number" }).notNull(),
    contextHash: text("context_hash"),
    runSeededTracking: integer("run_seeded_tracking").notNull(),
    competitorRunId: text("competitor_run_id"),
    state: text("state").notNull(),
    activeProjectId: text("active_project_id"),
    createdAtMs: bigint("created_at_ms", { mode: "number" }).notNull(),
    startedAtMs: bigint("started_at_ms", { mode: "number" }),
    deadlineAtMs: bigint("deadline_at_ms", { mode: "number" }).notNull(),
    finishedAtMs: bigint("finished_at_ms", { mode: "number" }),
    reason: text("reason"),
    redactedAtMs: bigint("redacted_at_ms", { mode: "number" }),
    reviewSnapshotJson: text("review_snapshot_json"),
    reviewHash: text("review_hash"),
    saveToken: text("save_token"),
    saveRequestHash: text("save_request_hash"),
    savedAtMs: bigint("saved_at_ms", { mode: "number" }),
    appliedContextVersion: bigint("applied_context_version", {
      mode: "number",
    }),
  },
  (t) => [
    uniqueIndex("website_attempt_scope_uidx").on(t.projectId, t.id),
    uniqueIndex("website_attempt_active_uidx").on(t.activeProjectId),
    index("website_attempt_recent_idx").on(
      t.projectId,
      t.mode,
      t.createdAtMs,
      t.id,
    ),
    foreignKey({
      columns: [t.projectId, t.competitorRunId],
      foreignColumns: [
        projectCompetitorResearchRuns.projectId,
        projectCompetitorResearchRuns.id,
      ],
    }).onDelete("no action"),
    check(
      "website_attempt_mode_check",
      sql`${t.mode} in ('direct','ai_setup')`,
    ),
    check(
      "website_attempt_surface_check",
      sql`${t.surface} in ('web','mcp','sam')`,
    ),
    check(
      "website_attempt_tracking_check",
      sql`${t.runSeededTracking} in (0,1)`,
    ),
    check(
      "website_attempt_state_check",
      sql`(${t.state} in ('admitted','running') and ${t.activeProjectId} is not null and ${t.activeProjectId}=${t.projectId} and ${t.finishedAtMs} is null and ${t.reviewSnapshotJson} is null and ${t.reviewHash} is null) or (${t.state} in ('review_ready','finished_no_review','failed','unknown') and ${t.activeProjectId} is null and ${t.finishedAtMs} is not null)`,
    ),
    check(
      "website_attempt_execution_check",
      sql`(${t.state}='admitted' and ${t.executionToken} is null and ${t.startedAtMs} is null) or (${t.state}='running' and ${t.executionToken} is not null and ${t.startedAtMs} is not null) or (${t.state} in ('review_ready','finished_no_review','failed','unknown'))`,
    ),
    check(
      "website_attempt_review_check",
      sql`(${t.state}='review_ready' and ${t.reviewSnapshotJson} is not null and ${t.reviewHash} is not null) or (${t.state}<>'review_ready' and ${t.reviewSnapshotJson} is null and ${t.reviewHash} is null)`,
    ),
    check(
      "website_attempt_save_check",
      sql`(${t.saveToken} is null and ${t.saveRequestHash} is null and ${t.savedAtMs} is null and ${t.appliedContextVersion} is null) or (${t.saveToken} is not null and ${t.saveRequestHash} is not null and ${t.savedAtMs} is not null and ${t.appliedContextVersion} is not null and ${t.state}='review_ready')`,
    ),
    check(
      "website_attempt_restored_check",
      sql`${t.reason}<>'restored' or (${t.state} in ('review_ready','finished_no_review','failed','unknown') and ${t.sponsorUserId} is null and ${t.sponsorMemberId} is null and ${t.sponsorRole} is null and ${t.executionToken} is null and ${t.saveToken} is null and ${t.saveRequestHash} is null and ${t.activeProjectId} is null)`,
    ),
    check(
      "website_attempt_bounds_check",
      sql`${t.contextVersion}>=0 and ${t.locationCode}>0 and ${t.createdAtMs}>=0 and ${t.deadlineAtMs}>${t.createdAtMs} and (${t.startedAtMs} is null or ${t.startedAtMs}>=${t.createdAtMs}) and (${t.finishedAtMs} is null or ${t.finishedAtMs}>=${t.createdAtMs}) and (${t.redactedAtMs} is null or ${t.redactedAtMs}>=0) and (${t.appliedContextVersion} is null or ${t.appliedContextVersion}>=0) and (${t.reviewSnapshotJson} is null or octet_length(${t.reviewSnapshotJson})<=65536)`,
    ),
  ],
);
