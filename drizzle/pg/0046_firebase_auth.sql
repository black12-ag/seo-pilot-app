CREATE TABLE "firebase_identities" (
	"firebase_project_id" text NOT NULL,
	"firebase_uid" text NOT NULL,
	"user_id" text NOT NULL,
	"created_at_ms" bigint NOT NULL,
	CONSTRAINT "firebase_identities_firebase_project_id_firebase_uid_pk" PRIMARY KEY("firebase_project_id","firebase_uid"),
	CONSTRAINT "firebase_identities_fields_check" CHECK (length("firebase_identities"."firebase_project_id") > 0 and length("firebase_identities"."firebase_uid") > 0 and "firebase_identities"."created_at_ms" between 0 and 9007199254740991)
);
--> statement-breakpoint
CREATE TABLE "firebase_session_proofs" (
	"session_id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"firebase_project_id" text NOT NULL,
	"firebase_uid" text NOT NULL,
	"encrypted_proof" text NOT NULL,
	"auth_time_seconds" bigint NOT NULL,
	"token_expires_at_ms" bigint NOT NULL,
	"created_at_ms" bigint NOT NULL,
	CONSTRAINT "firebase_session_proofs_fields_check" CHECK (length("firebase_session_proofs"."encrypted_proof") > 0 and "firebase_session_proofs"."auth_time_seconds" between 0 and 9007199254740991 and "firebase_session_proofs"."token_expires_at_ms" between 0 and 9007199254740991 and "firebase_session_proofs"."created_at_ms" between 0 and 9007199254740991)
);
--> statement-breakpoint
ALTER TABLE "firebase_identities" ADD CONSTRAINT "firebase_identities_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "firebase_session_proofs" ADD CONSTRAINT "firebase_session_proofs_session_id_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."session"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "firebase_session_proofs" ADD CONSTRAINT "firebase_session_proofs_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "firebase_session_proofs" ADD CONSTRAINT "firebase_session_proofs_firebase_project_id_firebase_uid_firebase_identities_firebase_project_id_firebase_uid_fk" FOREIGN KEY ("firebase_project_id","firebase_uid") REFERENCES "public"."firebase_identities"("firebase_project_id","firebase_uid") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "firebase_identities_project_user_uidx" ON "firebase_identities" USING btree ("firebase_project_id","user_id");--> statement-breakpoint
CREATE INDEX "firebase_identities_user_idx" ON "firebase_identities" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "firebase_session_proofs_user_idx" ON "firebase_session_proofs" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "firebase_session_proofs_identity_idx" ON "firebase_session_proofs" USING btree ("firebase_project_id","firebase_uid");