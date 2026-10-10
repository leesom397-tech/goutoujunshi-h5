ALTER TABLE `coach_wechat_links` ADD `memory_offer_report_id` text;--> statement-breakpoint
ALTER TABLE `coach_wechat_links` ADD `memory_offer_expires_at` integer DEFAULT 0 NOT NULL;