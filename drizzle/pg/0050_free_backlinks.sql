CREATE TABLE "free_backlink_profiles" (
	"domain" text PRIMARY KEY NOT NULL,
	"release" text NOT NULL,
	"published_at" text,
	"referring_domains" integer NOT NULL,
	"referrers" text NOT NULL,
	"imported_at" text NOT NULL
);
