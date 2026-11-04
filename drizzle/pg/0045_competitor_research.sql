CREATE TABLE "project_competitor_research_candidates" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"run_id" text NOT NULL,
	"domain" text NOT NULL,
	"rank_order" integer NOT NULL,
	"search_slot" text,
	"requested_url" text,
	"source_url" text,
	"source_excerpt" text,
	"source_hash" text,
	"source_captured_at_ms" bigint,
	"extraction_method" text,
	"extraction_reason" text,
	"partial_evidence" integer DEFAULT 0 NOT NULL,
	"classification" text NOT NULL,
	"name" text,
	"rationale" text,
	"selected" integer DEFAULT 0 NOT NULL,
	"accepted_name" text,
	"accepted_notes" text,
	"acceptance_outcome" text,
	"canonical_competitor_id" text,
	"canonical_inserted_at" text,
	CONSTRAINT "competitor_candidates_rank_check" CHECK ("project_competitor_research_candidates"."rank_order" between 0 and 4),
	CONSTRAINT "competitor_candidates_class_check" CHECK ("project_competitor_research_candidates"."classification" in ('pending','verified','not_competitor','unreadable','invalid')),
	CONSTRAINT "competitor_candidates_bool_check" CHECK ("project_competitor_research_candidates"."selected" in (0,1) and "project_competitor_research_candidates"."partial_evidence" in (0,1)),
	CONSTRAINT "competitor_candidates_outcome_check" CHECK ("project_competitor_research_candidates"."acceptance_outcome" is null or "project_competitor_research_candidates"."acceptance_outcome" in ('added','already_saved')),
	CONSTRAINT "competitor_candidates_extraction_check" CHECK ("project_competitor_research_candidates"."extraction_method" is null or "project_competitor_research_candidates"."extraction_method" in ('public_html_text','public_plain_text','legacy_read_site')),
	CONSTRAINT "competitor_candidates_slot_check" CHECK ("project_competitor_research_candidates"."search_slot" is null or "project_competitor_research_candidates"."search_slot" in ('search_0','search_1')),
	CONSTRAINT "competitor_candidates_time_check" CHECK ("project_competitor_research_candidates"."source_captured_at_ms" is null or "project_competitor_research_candidates"."source_captured_at_ms" >= 0)
);
--> statement-breakpoint
CREATE TABLE "project_competitor_research_operations" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"run_id" text NOT NULL,
	"slot" text NOT NULL,
	"kind" text NOT NULL,
	"state" text NOT NULL,
	"issue_token" text,
	"input_hash" text,
	"query_text" text,
	"target_url" text,
	"candidate_id" text,
	"issued_at_ms" bigint,
	"finished_at_ms" bigint,
	"reason" text,
	"provider" text,
	"provider_task_id" text,
	"backend_model_id" text,
	"usage_basis" text NOT NULL,
	"cost_usd" double precision,
	"input_tokens" bigint,
	"output_tokens" bigint,
	CONSTRAINT "competitor_ops_slot_check" CHECK ("project_competitor_research_operations"."slot" in ('own_page','search_0','search_1','page_0','page_1','page_2','page_3','page_4','classify','setup_evidence')),
	CONSTRAINT "competitor_ops_kind_check" CHECK ("project_competitor_research_operations"."kind" in ('page','search','model','legacy')),
	CONSTRAINT "competitor_ops_state_check" CHECK ("project_competitor_research_operations"."state" in ('prepared','issued','succeeded','failed','unknown')),
	CONSTRAINT "competitor_ops_reason_check" CHECK ("project_competitor_research_operations"."reason" is null or "project_competitor_research_operations"."reason" in ('project_domain_missing','dataforseo_not_configured','model_not_configured','unsupported_background_authority','model_not_authorized','insufficient_credits','context_changed','project_changed','sponsor_changed','provider_unavailable','website_unreadable','invalid_model_output','evidence_rejected','deadline','launch_unconfirmed','operation_outcome_unknown','privacy_erased','restored')),
	CONSTRAINT "competitor_ops_receipt_check" CHECK (("project_competitor_research_operations"."state"='prepared' and "project_competitor_research_operations"."issued_at_ms" is null and "project_competitor_research_operations"."finished_at_ms" is null and "project_competitor_research_operations"."issue_token" is null) or ("project_competitor_research_operations"."state"='issued' and "project_competitor_research_operations"."issued_at_ms" is not null and "project_competitor_research_operations"."finished_at_ms" is null and "project_competitor_research_operations"."issue_token" is not null and "project_competitor_research_operations"."input_hash" is not null) or ("project_competitor_research_operations"."state" in ('succeeded','failed','unknown') and "project_competitor_research_operations"."finished_at_ms" is not null and (("project_competitor_research_operations"."kind"='legacy' and "project_competitor_research_operations"."issued_at_ms" is null) or ("project_competitor_research_operations"."issued_at_ms" is not null and "project_competitor_research_operations"."issue_token" is not null)))),
	CONSTRAINT "competitor_ops_basis_check" CHECK ("project_competitor_research_operations"."usage_basis" in ('usd','quota','unknown')),
	CONSTRAINT "competitor_ops_provider_check" CHECK ("project_competitor_research_operations"."provider" is null or "project_competitor_research_operations"."provider" in ('dataforseo','openrouter','owner_worker','public_fetch')),
	CONSTRAINT "competitor_ops_numbers_check" CHECK (("project_competitor_research_operations"."cost_usd" is null or ("project_competitor_research_operations"."cost_usd" >= 0 and "project_competitor_research_operations"."cost_usd" < 1e308)) and ("project_competitor_research_operations"."input_tokens" is null or "project_competitor_research_operations"."input_tokens" between 0 and 9007199254740991) and ("project_competitor_research_operations"."output_tokens" is null or "project_competitor_research_operations"."output_tokens" between 0 and 9007199254740991) and ("project_competitor_research_operations"."issued_at_ms" is null or "project_competitor_research_operations"."issued_at_ms" >= 0) and ("project_competitor_research_operations"."finished_at_ms" is null or "project_competitor_research_operations"."finished_at_ms" >= 0))
);
--> statement-breakpoint
CREATE TABLE "project_competitor_research_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"admission_token" text NOT NULL,
	"request_id" text NOT NULL,
	"request_hash" text NOT NULL,
	"origin" text NOT NULL,
	"state" text NOT NULL,
	"outcome" text,
	"reason" text,
	"active_project_id" text,
	"sponsor_user_id" text,
	"sponsor_member_id" text,
	"sponsor_role" text,
	"surface" text NOT NULL,
	"model_backend_id" text,
	"model_configuration_hash" text NOT NULL,
	"domain" text,
	"location_code" integer NOT NULL,
	"language_code" text NOT NULL,
	"context_version" bigint NOT NULL,
	"context_hash" text NOT NULL,
	"business_summary" text NOT NULL,
	"own_source_url" text,
	"own_source_hash" text,
	"own_source_captured_at_ms" bigint,
	"limits_profile" text,
	"created_at_ms" bigint NOT NULL,
	"started_at_ms" bigint,
	"deadline_at_ms" bigint NOT NULL,
	"finished_at_ms" bigint,
	"workflow_observed_at_ms" bigint,
	"revoked_at_ms" bigint,
	"redacted_at_ms" bigint,
	"billing_state" text NOT NULL,
	"billing_token" text,
	"review_mutation_id" text,
	"review_token" text,
	"review_request_hash" text,
	"reviewed_at_ms" bigint,
	"reviewed_by_user_id" text,
	"applied_context_version" bigint,
	CONSTRAINT "competitor_runs_origin_check" CHECK ("project_competitor_research_runs"."origin" in ('explicit','setup')),
	CONSTRAINT "competitor_runs_surface_check" CHECK ("project_competitor_research_runs"."surface" in ('web','mcp','sam')),
	CONSTRAINT "competitor_runs_state_check" CHECK (("project_competitor_research_runs"."state" in ('queued','running') and "project_competitor_research_runs"."outcome" is null and "project_competitor_research_runs"."finished_at_ms" is null and "project_competitor_research_runs"."active_project_id" is not null and "project_competitor_research_runs"."active_project_id" = "project_competitor_research_runs"."project_id") or ("project_competitor_research_runs"."state" = 'finished' and "project_competitor_research_runs"."outcome" is not null and "project_competitor_research_runs"."outcome" in ('complete','partial','unavailable','failed','blocked','unknown') and "project_competitor_research_runs"."finished_at_ms" is not null and "project_competitor_research_runs"."active_project_id" is null)),
	CONSTRAINT "competitor_runs_reason_check" CHECK ("project_competitor_research_runs"."reason" is null or "project_competitor_research_runs"."reason" in ('project_domain_missing','dataforseo_not_configured','model_not_configured','unsupported_background_authority','model_not_authorized','insufficient_credits','context_changed','project_changed','sponsor_changed','provider_unavailable','website_unreadable','invalid_model_output','evidence_rejected','deadline','launch_unconfirmed','operation_outcome_unknown','privacy_erased','restored')),
	CONSTRAINT "competitor_runs_profile_check" CHECK (("project_competitor_research_runs"."origin"='explicit' and "project_competitor_research_runs"."limits_profile" is not null and "project_competitor_research_runs"."limits_profile"='competitor-discovery-v1') or ("project_competitor_research_runs"."origin"='setup' and "project_competitor_research_runs"."limits_profile" is null)),
	CONSTRAINT "competitor_runs_billing_check" CHECK ("project_competitor_research_runs"."billing_state" in ('not_started','started','submitted','selfhost_external','unknown')),
	CONSTRAINT "competitor_runs_numbers_check" CHECK ("project_competitor_research_runs"."context_version" >= 0 and "project_competitor_research_runs"."location_code" > 0 and "project_competitor_research_runs"."created_at_ms" >= 0 and "project_competitor_research_runs"."deadline_at_ms" >= 0 and ("project_competitor_research_runs"."started_at_ms" is null or "project_competitor_research_runs"."started_at_ms" >= 0) and ("project_competitor_research_runs"."finished_at_ms" is null or "project_competitor_research_runs"."finished_at_ms" >= 0) and ("project_competitor_research_runs"."applied_context_version" is null or "project_competitor_research_runs"."applied_context_version" >= 0))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "competitor_runs_scope_uidx" ON "project_competitor_research_runs" USING btree ("project_id","id");--> statement-breakpoint
ALTER TABLE "project_competitor_research_candidates" ADD CONSTRAINT "project_competitor_research_candidates_canonical_competitor_id_project_competitors_id_fk" FOREIGN KEY ("canonical_competitor_id") REFERENCES "public"."project_competitors"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_competitor_research_candidates" ADD CONSTRAINT "project_competitor_research_candidates_project_id_run_id_project_competitor_research_runs_project_id_id_fk" FOREIGN KEY ("project_id","run_id") REFERENCES "public"."project_competitor_research_runs"("project_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_competitor_research_operations" ADD CONSTRAINT "project_competitor_research_operations_project_id_run_id_project_competitor_research_runs_project_id_id_fk" FOREIGN KEY ("project_id","run_id") REFERENCES "public"."project_competitor_research_runs"("project_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_competitor_research_runs" ADD CONSTRAINT "project_competitor_research_runs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_competitor_research_runs" ADD CONSTRAINT "project_competitor_research_runs_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_competitor_research_runs" ADD CONSTRAINT "project_competitor_research_runs_sponsor_user_id_user_id_fk" FOREIGN KEY ("sponsor_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_competitor_research_runs" ADD CONSTRAINT "project_competitor_research_runs_reviewed_by_user_id_user_id_fk" FOREIGN KEY ("reviewed_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "competitor_candidates_domain_uidx" ON "project_competitor_research_candidates" USING btree ("run_id","domain");--> statement-breakpoint
CREATE UNIQUE INDEX "competitor_candidates_scope_uidx" ON "project_competitor_research_candidates" USING btree ("project_id","run_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "competitor_ops_slot_uidx" ON "project_competitor_research_operations" USING btree ("run_id","slot");--> statement-breakpoint
CREATE UNIQUE INDEX "competitor_ops_scope_uidx" ON "project_competitor_research_operations" USING btree ("project_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "competitor_runs_request_uidx" ON "project_competitor_research_runs" USING btree ("project_id","request_id");--> statement-breakpoint
CREATE UNIQUE INDEX "competitor_runs_active_uidx" ON "project_competitor_research_runs" USING btree ("active_project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "competitor_runs_review_uidx" ON "project_competitor_research_runs" USING btree ("project_id","review_mutation_id");--> statement-breakpoint
CREATE INDEX "competitor_runs_recent_idx" ON "project_competitor_research_runs" USING btree ("project_id","created_at_ms","id");