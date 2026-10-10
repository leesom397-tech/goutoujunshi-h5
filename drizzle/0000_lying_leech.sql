CREATE TABLE `coach_facts` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`subject_id` text,
	`field` text NOT NULL,
	`value` text NOT NULL,
	`source` text NOT NULL,
	`evidence` text DEFAULT '' NOT NULL,
	`confidence` text DEFAULT 'medium' NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_coach_facts_owner_status` ON `coach_facts` (`owner_id`,`status`,`created_at`);--> statement-breakpoint
CREATE TABLE `coach_profiles` (
	`owner_id` text PRIMARY KEY NOT NULL,
	`consent_at` integer,
	`paused` integer DEFAULT 0 NOT NULL,
	`data` text DEFAULT '{}' NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `coach_subjects` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`label` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`data` text DEFAULT '{}' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_coach_subjects_owner` ON `coach_subjects` (`owner_id`,`updated_at`);