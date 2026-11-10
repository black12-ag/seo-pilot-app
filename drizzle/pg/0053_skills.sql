CREATE TABLE "sam_skill_schedules" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"project_id" text NOT NULL,
	"user_id" text NOT NULL,
	"skill_name" text NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"cadence" text NOT NULL,
	"weekday" integer,
	"hour" integer NOT NULL,
	"time_zone" text NOT NULL,
	"next_run_at_ms" bigint,
	"last_run_at" text,
	"last_status" text,
	"last_message" text,
	"last_session_id" text,
	"last_report_id" text,
	"created_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL,
	"updated_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sam_skills" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text NOT NULL,
	"instructions" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"created_by" text NOT NULL,
	"created_by_user_id" text NOT NULL,
	"created_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL,
	"updated_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sam_sessions" ADD COLUMN "skill_schedule_id" text;--> statement-breakpoint
ALTER TABLE "sam_skill_schedules" ADD CONSTRAINT "sam_skill_schedules_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sam_skill_schedules" ADD CONSTRAINT "sam_skill_schedules_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sam_skill_schedules" ADD CONSTRAINT "sam_skill_schedules_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sam_skills" ADD CONSTRAINT "sam_skills_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "sam_skill_schedules_project_skill_idx" ON "sam_skill_schedules" USING btree ("project_id","skill_name");--> statement-breakpoint
CREATE INDEX "sam_skill_schedules_due_idx" ON "sam_skill_schedules" USING btree ("enabled","next_run_at_ms");--> statement-breakpoint
CREATE UNIQUE INDEX "sam_skills_org_name_idx" ON "sam_skills" USING btree ("organization_id","name");