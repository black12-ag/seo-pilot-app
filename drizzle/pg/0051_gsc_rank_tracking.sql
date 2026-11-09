DROP INDEX "rank_tracking_configs_national_idx";--> statement-breakpoint
ALTER TABLE "rank_check_runs" ADD COLUMN "data_date" text;--> statement-breakpoint
ALTER TABLE "rank_snapshots" ADD COLUMN "source" text DEFAULT 'dataforseo' NOT NULL;--> statement-breakpoint
ALTER TABLE "rank_snapshots" ADD COLUMN "average_position" real;--> statement-breakpoint
ALTER TABLE "rank_snapshots" ADD COLUMN "impressions" integer;--> statement-breakpoint
ALTER TABLE "rank_snapshots" ADD COLUMN "clicks" integer;--> statement-breakpoint
ALTER TABLE "rank_tracking_configs" ADD COLUMN "source" text DEFAULT 'dataforseo' NOT NULL;--> statement-breakpoint
ALTER TABLE "rank_tracking_configs" ADD COLUMN "gsc_country" text DEFAULT '' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "rank_check_runs_config_data_date_idx" ON "rank_check_runs" USING btree ("config_id","data_date");--> statement-breakpoint
CREATE UNIQUE INDEX "rank_tracking_configs_gsc_idx" ON "rank_tracking_configs" USING btree ("project_id","domain","gsc_country") WHERE "rank_tracking_configs"."source" = 'gsc';--> statement-breakpoint
CREATE UNIQUE INDEX "rank_tracking_configs_national_idx" ON "rank_tracking_configs" USING btree ("project_id","domain","location_code","language_code") WHERE "rank_tracking_configs"."location_name" IS NULL AND "rank_tracking_configs"."source" = 'dataforseo';