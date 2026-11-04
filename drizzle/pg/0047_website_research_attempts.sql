CREATE TABLE "project_website_research_attempts" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"mode" text NOT NULL,
	"surface" text NOT NULL,
	"sponsor_user_id" text,
	"sponsor_member_id" text,
	"sponsor_role" text,
	"request_hash" text,
	"admission_token" text NOT NULL,
	"execution_token" text,
	"requested_website" text,
	"requested_domain" text,
	"snapshot_domain" text,
	"location_code" integer NOT NULL,
	"language_code" text NOT NULL,
	"context_version" bigint NOT NULL,
	"context_hash" text,
	"run_seeded_tracking" integer NOT NULL,
	"competitor_run_id" text,
	"state" text NOT NULL,
	"active_project_id" text,
	"created_at_ms" bigint NOT NULL,
	"started_at_ms" bigint,
	"deadline_at_ms" bigint NOT NULL,
	"finished_at_ms" bigint,
	"reason" text,
	"redacted_at_ms" bigint,
	"review_snapshot_json" text,
	"review_hash" text,
	"save_token" text,
	"save_request_hash" text,
	"saved_at_ms" bigint,
	"applied_context_version" bigint,
	CONSTRAINT "website_attempt_mode_check" CHECK ("project_website_research_attempts"."mode" in ('direct','ai_setup')),
	CONSTRAINT "website_attempt_surface_check" CHECK ("project_website_research_attempts"."surface" in ('web','mcp','sam')),
	CONSTRAINT "website_attempt_tracking_check" CHECK ("project_website_research_attempts"."run_seeded_tracking" in (0,1)),
	CONSTRAINT "website_attempt_state_check" CHECK (("project_website_research_attempts"."state" in ('admitted','running') and "project_website_research_attempts"."active_project_id" is not null and "project_website_research_attempts"."active_project_id"="project_website_research_attempts"."project_id" and "project_website_research_attempts"."finished_at_ms" is null and "project_website_research_attempts"."review_snapshot_json" is null and "project_website_research_attempts"."review_hash" is null) or ("project_website_research_attempts"."state" in ('review_ready','finished_no_review','failed','unknown') and "project_website_research_attempts"."active_project_id" is null and "project_website_research_attempts"."finished_at_ms" is not null)),
	CONSTRAINT "website_attempt_execution_check" CHECK (("project_website_research_attempts"."state"='admitted' and "project_website_research_attempts"."execution_token" is null and "project_website_research_attempts"."started_at_ms" is null) or ("project_website_research_attempts"."state"='running' and "project_website_research_attempts"."execution_token" is not null and "project_website_research_attempts"."started_at_ms" is not null) or ("project_website_research_attempts"."state" in ('review_ready','finished_no_review','failed','unknown'))),
	CONSTRAINT "website_attempt_review_check" CHECK (("project_website_research_attempts"."state"='review_ready' and "project_website_research_attempts"."review_snapshot_json" is not null and "project_website_research_attempts"."review_hash" is not null) or ("project_website_research_attempts"."state"<>'review_ready' and "project_website_research_attempts"."review_snapshot_json" is null and "project_website_research_attempts"."review_hash" is null)),
	CONSTRAINT "website_attempt_save_check" CHECK (("project_website_research_attempts"."save_token" is null and "project_website_research_attempts"."save_request_hash" is null and "project_website_research_attempts"."saved_at_ms" is null and "project_website_research_attempts"."applied_context_version" is null) or ("project_website_research_attempts"."save_token" is not null and "project_website_research_attempts"."save_request_hash" is not null and "project_website_research_attempts"."saved_at_ms" is not null and "project_website_research_attempts"."applied_context_version" is not null and "project_website_research_attempts"."state"='review_ready')),
	CONSTRAINT "website_attempt_restored_check" CHECK ("project_website_research_attempts"."reason"<>'restored' or ("project_website_research_attempts"."state" in ('review_ready','finished_no_review','failed','unknown') and "project_website_research_attempts"."sponsor_user_id" is null and "project_website_research_attempts"."sponsor_member_id" is null and "project_website_research_attempts"."sponsor_role" is null and "project_website_research_attempts"."execution_token" is null and "project_website_research_attempts"."save_token" is null and "project_website_research_attempts"."save_request_hash" is null and "project_website_research_attempts"."active_project_id" is null)),
	CONSTRAINT "website_attempt_bounds_check" CHECK ("project_website_research_attempts"."context_version">=0 and "project_website_research_attempts"."location_code">0 and "project_website_research_attempts"."created_at_ms">=0 and "project_website_research_attempts"."deadline_at_ms">"project_website_research_attempts"."created_at_ms" and ("project_website_research_attempts"."started_at_ms" is null or "project_website_research_attempts"."started_at_ms">="project_website_research_attempts"."created_at_ms") and ("project_website_research_attempts"."finished_at_ms" is null or "project_website_research_attempts"."finished_at_ms">="project_website_research_attempts"."created_at_ms") and ("project_website_research_attempts"."redacted_at_ms" is null or "project_website_research_attempts"."redacted_at_ms">=0) and ("project_website_research_attempts"."applied_context_version" is null or "project_website_research_attempts"."applied_context_version">=0) and ("project_website_research_attempts"."review_snapshot_json" is null or octet_length("project_website_research_attempts"."review_snapshot_json")<=65536))
);
--> statement-breakpoint
ALTER TABLE "project_website_research_attempts" ADD CONSTRAINT "project_website_research_attempts_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_website_research_attempts" ADD CONSTRAINT "project_website_research_attempts_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_website_research_attempts" ADD CONSTRAINT "project_website_research_attempts_sponsor_user_id_user_id_fk" FOREIGN KEY ("sponsor_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_website_research_attempts" ADD CONSTRAINT "project_website_research_attempts_project_id_competitor_run_id_project_competitor_research_runs_project_id_id_fk" FOREIGN KEY ("project_id","competitor_run_id") REFERENCES "public"."project_competitor_research_runs"("project_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "website_attempt_scope_uidx" ON "project_website_research_attempts" USING btree ("project_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "website_attempt_active_uidx" ON "project_website_research_attempts" USING btree ("active_project_id");--> statement-breakpoint
CREATE INDEX "website_attempt_recent_idx" ON "project_website_research_attempts" USING btree ("project_id","mode","created_at_ms","id");