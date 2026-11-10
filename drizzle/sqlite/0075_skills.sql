CREATE TABLE `sam_skill_schedules` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`project_id` text NOT NULL,
	`user_id` text NOT NULL,
	`skill_name` text NOT NULL,
	`enabled` integer DEFAULT false NOT NULL,
	`cadence` text NOT NULL,
	`weekday` integer,
	`hour` integer NOT NULL,
	`time_zone` text NOT NULL,
	`next_run_at_ms` integer,
	`last_run_at` text,
	`last_status` text,
	`last_message` text,
	`last_session_id` text,
	`last_report_id` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sam_skill_schedules_project_skill_idx` ON `sam_skill_schedules` (`project_id`,`skill_name`);--> statement-breakpoint
CREATE INDEX `sam_skill_schedules_due_idx` ON `sam_skill_schedules` (`enabled`,`next_run_at_ms`);--> statement-breakpoint
CREATE TABLE `sam_skills` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`name` text NOT NULL,
	`description` text NOT NULL,
	`instructions` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`created_by` text NOT NULL,
	`created_by_user_id` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sam_skills_org_name_idx` ON `sam_skills` (`organization_id`,`name`);--> statement-breakpoint
ALTER TABLE `sam_sessions` ADD `skill_schedule_id` text;