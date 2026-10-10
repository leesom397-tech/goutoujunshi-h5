CREATE TABLE `coach_positionings` (
	`owner_id` text PRIMARY KEY NOT NULL,
	`input_json` text NOT NULL,
	`report_json` text NOT NULL,
	`updated_at` integer NOT NULL
);
