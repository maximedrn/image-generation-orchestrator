CREATE TABLE `jobs` (
	`attempt` integer DEFAULT 0 NOT NULL,
	`cancel_requested` integer DEFAULT false NOT NULL,
	`cost` integer NOT NULL,
	`created_at` text NOT NULL,
	`engine_id` text,
	`error_code` text,
	`error_message` text,
	`id` text PRIMARY KEY NOT NULL,
	`lease_until` text,
	`model` text,
	`remote_job_id` text,
	`request_json` text NOT NULL,
	`status` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_jobs_queue` ON `jobs` (`status`,`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `idx_jobs_running_lease` ON `jobs` (`status`,`lease_until`);--> statement-breakpoint
CREATE INDEX `idx_jobs_model_status` ON `jobs` (`model`,`status`);--> statement-breakpoint
CREATE TABLE `results` (
	`index` integer NOT NULL,
	`job_id` text NOT NULL,
	`mime_type` text NOT NULL,
	`path` text NOT NULL,
	`sha256` text NOT NULL,
	`size_bytes` integer NOT NULL,
	PRIMARY KEY(`job_id`, `index`)
);
