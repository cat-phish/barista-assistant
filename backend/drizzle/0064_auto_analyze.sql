CREATE TABLE `analysis_requests` (
	`brew_log_id` varchar(36) NOT NULL,
	`due_at` timestamp,
	`error` varchar(200),
	`updated_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `analysis_requests_brew_log_id` PRIMARY KEY(`brew_log_id`)
);
--> statement-breakpoint
ALTER TABLE `llm_analyses` ADD `auto` boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `analysis_requests` ADD CONSTRAINT `analysis_requests_brew_log_id_brew_logs_id_fk` FOREIGN KEY (`brew_log_id`) REFERENCES `brew_logs`(`id`) ON DELETE cascade ON UPDATE no action;