ALTER TABLE `coach_crush_threads` ADD `voice_pending` text DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE `coach_crush_threads` ADD `voice_pending_expires_at` integer DEFAULT 0 NOT NULL;