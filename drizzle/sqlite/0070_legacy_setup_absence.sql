ALTER TABLE `projects` ADD COLUMN `legacy_setup_absence_proven` integer DEFAULT 0 NOT NULL CONSTRAINT `projects_legacy_setup_absence_proven_check` CHECK (`legacy_setup_absence_proven` in (0,1));
