CREATE TABLE `coach_miniapp_links` (
	`open_id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_coach_miniapp_links_owner` ON `coach_miniapp_links` (`owner_id`);--> statement-breakpoint
CREATE TABLE `coach_miniapp_pairings` (
	`code_hash` text PRIMARY KEY NOT NULL,
	`open_id` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_coach_miniapp_pairings_open` ON `coach_miniapp_pairings` (`open_id`);--> statement-breakpoint
CREATE TABLE `coach_miniapp_sessions` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`open_id` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_coach_miniapp_sessions_open` ON `coach_miniapp_sessions` (`open_id`);