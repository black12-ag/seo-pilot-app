ALTER TABLE "ai_observations" ADD COLUMN "answered_by" text;--> statement-breakpoint
ALTER TABLE "ai_observations" ADD COLUMN "answer_mode" text;--> statement-breakpoint
ALTER TABLE "ai_trackers" ADD COLUMN "own_ai" boolean DEFAULT false NOT NULL;