import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  index,
  integer,
  pgTable,
  text,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { organization, user } from "./better-auth-schema";
import { projects } from "./app.schema";

// See src/db/pg/app.schema.ts for why timestamps are ISO-8601 UTC text.
const isoNow = sql`to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;

// One row per SAM chat session. The conversation history itself lives in the
// SamChatAgent Durable Object's SQLite (keyed by this id); this table is the
// listable registry the session side-panel reads from, and the project/user
// scoping the Worker authorizes a connection against before it reaches the DO.
// Normalized on purpose: org and user email are derived from the project and
// user rows at read time, never snapshotted here.
export const samSessions = pgTable(
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
    createdAt: text("created_at").notNull().default(isoNow),
    updatedAt: text("updated_at").notNull().default(isoNow),
    // Soft-delete marker: null = active. Archived sessions disappear from the
    // list but keep their registry row and DO transcript for a future unarchive.
    archivedAt: text("archived_at"),
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

// Postgres mirror of sam_skills. Column notes: see ../sam.schema.ts.
export const samSkills = pgTable(
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
    createdBy: text("created_by").notNull(),
    createdByUserId: text("created_by_user_id").notNull(),
    createdAt: text("created_at").notNull().default(isoNow),
    updatedAt: text("updated_at").notNull().default(isoNow),
  },
  (table) => [
    uniqueIndex("sam_skills_org_name_idx").on(table.organizationId, table.name),
  ],
);

// Postgres mirror of sam_skill_schedules. Column notes: see ../sam.schema.ts.
export const samSkillSchedules = pgTable(
  "sam_skill_schedules",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    skillName: text("skill_name").notNull(),
    enabled: boolean("enabled").notNull().default(false),
    cadence: text("cadence", { enum: ["daily", "weekly"] }).notNull(),
    weekday: integer("weekday"),
    hour: integer("hour").notNull(),
    timeZone: text("time_zone").notNull(),
    nextRunAtMs: bigint("next_run_at_ms", { mode: "number" }),
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
