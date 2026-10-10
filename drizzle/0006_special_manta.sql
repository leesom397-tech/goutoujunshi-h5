ALTER TABLE `coach_crush_settings` ADD `image_consent_at` integer;--> statement-breakpoint
ALTER TABLE `coach_crush_settings` ADD `image_self_side` text DEFAULT 'ask' NOT NULL;--> statement-breakpoint
ALTER TABLE `coach_crush_threads` ADD `image_pending` text DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE `coach_crush_threads` ADD `image_pending_expires_at` integer DEFAULT 0 NOT NULL;