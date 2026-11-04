CREATE TABLE `wordpress_connections` (
	`project_id` text PRIMARY KEY NOT NULL,
	`origin` text NOT NULL,
	`credential_id` text NOT NULL,
	`sealed_credential` text NOT NULL,
	`read_status` text NOT NULL,
	`write_status` text NOT NULL,
	`read_checked_at_ms` integer,
	`write_checked_at_ms` integer,
	`created_by_user_id` text,
	`created_at_ms` integer NOT NULL,
	`updated_at_ms` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "wordpress_connections_read_status_check" CHECK("wordpress_connections"."read_status" in ('unchecked','granted','failed','revoked')),
	CONSTRAINT "wordpress_connections_write_status_check" CHECK("wordpress_connections"."write_status" in ('unchecked','granted','failed','revoked'))
);
--> statement-breakpoint
CREATE TABLE `wordpress_publish_records` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`content_id` text NOT NULL,
	`revision_id` text NOT NULL,
	`idempotency_key` text NOT NULL,
	`origin` text NOT NULL,
	`title` text NOT NULL,
	`slug` text NOT NULL,
	`content_hash` text NOT NULL,
	`state` text NOT NULL,
	`attempt` integer NOT NULL,
	`last_attempt_at_ms` integer NOT NULL,
	`failure_code` text,
	`mismatch_fields` text,
	`remote_post_id` integer,
	`remote_revision_id` integer,
	`remote_modified_gmt` text,
	`remote_status` text,
	`remote_content_hash` text,
	`verified_at_ms` integer,
	`trashed_at_ms` integer,
	`created_by_user_id` text,
	`created_at_ms` integer NOT NULL,
	`updated_at_ms` integer NOT NULL,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`project_id`,`content_id`,`revision_id`) REFERENCES `content_revisions`(`project_id`,`content_id`,`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "wordpress_publish_records_state_check" CHECK("wordpress_publish_records"."state" in ('sending','uncertain','not_found','failed','verified','mismatch','trashing','trash_uncertain','trashed')),
	CONSTRAINT "wordpress_publish_records_attempt_check" CHECK("wordpress_publish_records"."attempt" >= 1)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `wordpress_publish_records_project_key_uidx` ON `wordpress_publish_records` (`project_id`,`idempotency_key`);--> statement-breakpoint
CREATE INDEX `wordpress_publish_records_project_created_idx` ON `wordpress_publish_records` (`project_id`,`created_at_ms`);--> statement-breakpoint
CREATE INDEX `wordpress_publish_records_revision_idx` ON `wordpress_publish_records` (`project_id`,`content_id`,`revision_id`);
