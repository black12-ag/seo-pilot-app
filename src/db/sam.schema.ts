import {
  sqliteTable,
  text,
  index,
  integer,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";
import { organization, user } from "./better-auth-schema";
import { projects } from "./app.schema";

// One row per SAM chat session. The conversation history itself lives in the
// SamChatAgent Durable Object's SQLite (keyed by this id); this table is the
// listable registry the session side-panel reads from, and the project/user
// scoping the Worker authorizes a connection against before it reaches the DO.
// Normalized on purpose: org and user email are derived from the project and
// user rows at read time, never snapshotted here.
export const samSessions = sqliteTable(
  "sam_sessions",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    title: text("title").notNull().default("New chat"),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(current_timestamp)`),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`(current_timestamp)`),
    // Soft-delete marker: null = active. Archived sessions disappear from the
    // list but keep their registry row and DO transcript for a future unarchive.
    archivedAt: text("archived_at"),
    // Set when a skill schedule started this session (no FK: deleting the
    // schedule leaves its past runs readable). Its turn ends by saving the
    // reply as a report.
    skillScheduleId: text("skill_schedule_id"),
  },
  (table) => [
    // The side-panel lists a project's sessions newest-first.
    index("sam_sessions_project_updated_idx").on(
      table.projectId,
      table.updatedAt,
    ),
  ],
);

const isoNow = sql`(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`;

// Skills a workspace wrote for SAM, in the Agent Skills shape (name +
// description + markdown instructions). Organization-scoped: a skill is a
// workflow, not project data, so every project in the workspace can use it.
// Only `enabled` rows reach SAM; `draft` is what SAM's save_skill writes and a
// person turns on from the Skills page.
export const samSkills = sqliteTable(
  "sam_skills",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description").notNull(),
    instructions: text("instructions").notNull(),
    status: text("status", { enum: ["draft", "enabled", "disabled"] })
      .notNull()
      .default("draft"),
    // Client label ("SEO Pilot app", "SAM") and the authenticated user. No FK
    // on the user, as reports: erasing a user must not delete the
    // workspace's skills.
    createdBy: text("created_by").notNull(),
    createdByUserId: text("created_by_user_id").notNull(),
    createdAt: text("created_at").notNull().default(isoNow),
    updatedAt: text("updated_at").notNull().default(isoNow),
  },
  (table) => [
    uniqueIndex("sam_skills_org_name_idx").on(table.organizationId, table.name),
  ],
);

// A skill run on a calendar for one project. Built-in skills can be scheduled
// too, so the skill is referenced by name; deleting a custom skill deletes its
// schedules in the service.
export const samSkillSchedules = sqliteTable(
  "sam_skill_schedules",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    // The person whose SAM session each run opens in, and whose access the
    // run is checked against.
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    skillName: text("skill_name").notNull(),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(false),
    cadence: text("cadence", { enum: ["daily", "weekly"] }).notNull(),
    weekday: integer("weekday"),
    hour: integer("hour").notNull(),
    timeZone: text("time_zone").notNull(),
    // Null while off.
    nextRunAtMs: integer("next_run_at_ms"),
    lastRunAt: text("last_run_at"),
    lastStatus: text("last_status", {
      enum: ["running", "completed", "failed", "needs_ai"],
    }),
    lastMessage: text("last_message"),
    lastSessionId: text("last_session_id"),
    lastReportId: text("last_report_id"),
    createdAt: text("created_at").notNull().default(isoNow),
    updatedAt: text("updated_at").notNull().default(isoNow),
  },
  (table) => [
    uniqueIndex("sam_skill_schedules_project_skill_idx").on(
      table.projectId,
      table.skillName,
    ),
    index("sam_skill_schedules_due_idx").on(table.enabled, table.nextRunAtMs),
  ],
);
