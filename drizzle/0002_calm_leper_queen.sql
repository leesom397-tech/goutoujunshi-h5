CREATE TABLE `coach_wechat_bind_codes` (
	`code_hash` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_coach_wechat_bind_codes_owner` ON `coach_wechat_bind_codes` (`owner_id`);--> statement-breakpoint
CREATE TABLE `coach_wechat_cursors` (
	`open_kfid` text PRIMARY KEY NOT NULL,
	`cursor` text DEFAULT '' NOT NULL,
	`lease_until` integer DEFAULT 0 NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `coach_wechat_links` (
	`external_userid` text PRIMARY KEY NOT NULL,
	`open_kfid` text NOT NULL,
	`owner_id` text NOT NULL,
	`subject_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_coach_wechat_links_owner` ON `coach_wechat_links` (`owner_id`);--> statement-breakpoint
CREATE TABLE `coach_wechat_messages` (
	`msgid` text PRIMARY KEY NOT NULL,
	`open_kfid` text NOT NULL,
	`external_userid` text NOT NULL,
	`status` text DEFAULT 'processing' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
