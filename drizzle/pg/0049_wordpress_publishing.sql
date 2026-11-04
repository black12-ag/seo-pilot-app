CREATE TABLE "wordpress_connections" (
	"project_id" text PRIMARY KEY NOT NULL,
	"origin" text NOT NULL,
	"credential_id" text NOT NULL,
	"sealed_credential" text NOT NULL,
	"read_status" text NOT NULL,
	"write_status" text NOT NULL,
	"read_checked_at_ms" bigint,
	"write_checked_at_ms" bigint,
	"created_by_user_id" text,
	"created_at_ms" bigint NOT NULL,
	"updated_at_ms" bigint NOT NULL,
	CONSTRAINT "wordpress_connections_read_status_check" CHECK ("wordpress_connections"."read_status" in ('unchecked','granted','failed','revoked')),
	CONSTRAINT "wordpress_connections_write_status_check" CHECK ("wordpress_connections"."write_status" in ('unchecked','granted','failed','revoked'))
);
--> statement-breakpoint
CREATE TABLE "wordpress_publish_records" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"content_id" text NOT NULL,
	"revision_id" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"origin" text NOT NULL,
	"title" text NOT NULL,
	"slug" text NOT NULL,
	"content_hash" text NOT NULL,
	"state" text NOT NULL,
	"attempt" integer NOT NULL,
	"last_attempt_at_ms" bigint NOT NULL,
	"failure_code" text,
	"mismatch_fields" text,
	"remote_post_id" bigint,
	"remote_revision_id" bigint,
	"remote_modified_gmt" text,
	"remote_status" text,
	"remote_content_hash" text,
	"verified_at_ms" bigint,
	"trashed_at_ms" bigint,
	"created_by_user_id" text,
	"created_at_ms" bigint NOT NULL,
	"updated_at_ms" bigint NOT NULL,
	CONSTRAINT "wordpress_publish_records_state_check" CHECK ("wordpress_publish_records"."state" in ('sending','uncertain','not_found','failed','verified','mismatch','trashing','trash_uncertain','trashed')),
	CONSTRAINT "wordpress_publish_records_attempt_check" CHECK ("wordpress_publish_records"."attempt" >= 1)
);
--> statement-breakpoint
ALTER TABLE "wordpress_connections" ADD CONSTRAINT "wordpress_connections_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wordpress_connections" ADD CONSTRAINT "wordpress_connections_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wordpress_publish_records" ADD CONSTRAINT "wordpress_publish_records_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wordpress_publish_records" ADD CONSTRAINT "wordpress_publish_records_project_id_content_id_revision_id_content_revisions_project_id_content_id_id_fk" FOREIGN KEY ("project_id","content_id","revision_id") REFERENCES "public"."content_revisions"("project_id","content_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "wordpress_publish_records_project_key_uidx" ON "wordpress_publish_records" USING btree ("project_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "wordpress_publish_records_project_created_idx" ON "wordpress_publish_records" USING btree ("project_id","created_at_ms");--> statement-breakpoint
CREATE INDEX "wordpress_publish_records_revision_idx" ON "wordpress_publish_records" USING btree ("project_id","content_id","revision_id");