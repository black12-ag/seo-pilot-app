CREATE TABLE `firebase_identities` (
	`firebase_project_id` text NOT NULL,
	`firebase_uid` text NOT NULL,
	`user_id` text NOT NULL,
	`created_at_ms` integer NOT NULL,
	PRIMARY KEY(`firebase_project_id`, `firebase_uid`),
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "firebase_identities_fields_check" CHECK(length("firebase_identities"."firebase_project_id") > 0 and length("firebase_identities"."firebase_uid") > 0 and "firebase_identities"."created_at_ms" between 0 and 9007199254740991 and "firebase_identities"."created_at_ms" = cast("firebase_identities"."created_at_ms" as integer))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `firebase_identities_project_user_uidx` ON `firebase_identities` (`firebase_project_id`,`user_id`);--> statement-breakpoint
CREATE INDEX `firebase_identities_user_idx` ON `firebase_identities` (`user_id`);--> statement-breakpoint
CREATE TABLE `firebase_session_proofs` (
	`session_id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`firebase_project_id` text NOT NULL,
	`firebase_uid` text NOT NULL,
	`encrypted_proof` text NOT NULL,
	`auth_time_seconds` integer NOT NULL,
	`token_expires_at_ms` integer NOT NULL,
	`created_at_ms` integer NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `session`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`firebase_project_id`,`firebase_uid`) REFERENCES `firebase_identities`(`firebase_project_id`,`firebase_uid`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "firebase_session_proofs_fields_check" CHECK(length("firebase_session_proofs"."encrypted_proof") > 0 and "firebase_session_proofs"."auth_time_seconds" between 0 and 9007199254740991 and "firebase_session_proofs"."auth_time_seconds" = cast("firebase_session_proofs"."auth_time_seconds" as integer) and "firebase_session_proofs"."token_expires_at_ms" between 0 and 9007199254740991 and "firebase_session_proofs"."token_expires_at_ms" = cast("firebase_session_proofs"."token_expires_at_ms" as integer) and "firebase_session_proofs"."created_at_ms" between 0 and 9007199254740991 and "firebase_session_proofs"."created_at_ms" = cast("firebase_session_proofs"."created_at_ms" as integer))
);
--> statement-breakpoint
CREATE INDEX `firebase_session_proofs_user_idx` ON `firebase_session_proofs` (`user_id`);--> statement-breakpoint
CREATE INDEX `firebase_session_proofs_identity_idx` ON `firebase_session_proofs` (`firebase_project_id`,`firebase_uid`);