ALTER TABLE `ai_observations` ADD `answered_by` text;--> statement-breakpoint
ALTER TABLE `ai_observations` ADD `answer_mode` text;--> statement-breakpoint
ALTER TABLE `ai_trackers` ADD `own_ai` integer DEFAULT false NOT NULL;