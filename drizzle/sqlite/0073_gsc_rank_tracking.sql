DROP INDEX `rank_tracking_configs_national_idx`;--> statement-breakpoint
ALTER TABLE `rank_tracking_configs` ADD `source` text DEFAULT 'dataforseo' NOT NULL;--> statement-breakpoint
ALTER TABLE `rank_tracking_configs` ADD `gsc_country` text DEFAULT '' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `rank_tracking_configs_gsc_idx` ON `rank_tracking_configs` (`project_id`,`domain`,`gsc_country`) WHERE "rank_tracking_configs"."source" = 'gsc';--> statement-breakpoint
CREATE UNIQUE INDEX `rank_tracking_configs_national_idx` ON `rank_tracking_configs` (`project_id`,`domain`,`location_code`,`language_code`) WHERE "rank_tracking_configs"."location_name" IS NULL AND "rank_tracking_configs"."source" = 'dataforseo';--> statement-breakpoint
ALTER TABLE `rank_check_runs` ADD `data_date` text;--> statement-breakpoint
CREATE UNIQUE INDEX `rank_check_runs_config_data_date_idx` ON `rank_check_runs` (`config_id`,`data_date`);--> statement-breakpoint
ALTER TABLE `rank_snapshots` ADD `source` text DEFAULT 'dataforseo' NOT NULL;--> statement-breakpoint
ALTER TABLE `rank_snapshots` ADD `average_position` real;--> statement-breakpoint
ALTER TABLE `rank_snapshots` ADD `impressions` integer;--> statement-breakpoint
ALTER TABLE `rank_snapshots` ADD `clicks` integer;