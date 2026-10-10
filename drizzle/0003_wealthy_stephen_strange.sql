CREATE TABLE `coach_crush_budget` (
	`id` text PRIMARY KEY NOT NULL,
	`uses` integer DEFAULT 0 NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `coach_crush_reports` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`thread_id` text NOT NULL,
	`source_key` text NOT NULL,
	`input_hash` text NOT NULL,
	`revision` integer NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`result` text DEFAULT '{}' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_crush_reports_source` ON `coach_crush_reports` (`owner_id`,`source_key`);--> statement-breakpoint
CREATE INDEX `idx_crush_reports_thread` ON `coach_crush_reports` (`owner_id`,`thread_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_crush_reports_expiry` ON `coach_crush_reports` (`expires_at`);--> statement-breakpoint
CREATE TABLE `coach_crush_settings` (
	`owner_id` text PRIMARY KEY NOT NULL,
	`consent_at` integer,
	`jev_consent_at` integer,
	`provider` text DEFAULT 'qwen' NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `coach_crush_threads` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`subject_id` text,
	`channel_key` text NOT NULL,
	`data` text DEFAULT '[]' NOT NULL,
	`self_label` text DEFAULT '' NOT NULL,
	`draft` text DEFAULT '' NOT NULL,
	`collecting` integer DEFAULT 0 NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL,
	`lease_until` integer DEFAULT 0 NOT NULL,
	`updated_at` integer NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_crush_threads_owner_channel` ON `coach_crush_threads` (`owner_id`,`channel_key`);--> statement-breakpoint
CREATE INDEX `idx_crush_threads_expiry` ON `coach_crush_threads` (`expires_at`);--> statement-breakpoint
CREATE TABLE `coach_wechat_inbox` (
	`id` text PRIMARY KEY NOT NULL,
	`open_kfid` text NOT NULL,
	`external_userid` text NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`payload` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`updated_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_wechat_inbox_pending` ON `coach_wechat_inbox` (`status`,`updated_at`);--> statement-breakpoint
CREATE INDEX `idx_wechat_inbox_conversation` ON `coach_wechat_inbox` (`open_kfid`,`external_userid`,`created_at`);--> statement-breakpoint
CREATE TABLE `coach_wechat_outbox` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text,
	`open_kfid` text NOT NULL,
	`external_userid` text NOT NULL,
	`payload` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_wechat_outbox_owner` ON `coach_wechat_outbox` (`owner_id`);--> statement-breakpoint
CREATE INDEX `idx_wechat_outbox_expiry` ON `coach_wechat_outbox` (`expires_at`);