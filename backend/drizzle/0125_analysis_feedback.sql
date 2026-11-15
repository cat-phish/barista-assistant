ALTER TABLE `llm_analyses` ADD `feedback_by` varchar(36);--> statement-breakpoint
ALTER TABLE `llm_analyses` ADD `feedback_reason` varchar(300);--> statement-breakpoint
ALTER TABLE `llm_analyses` ADD CONSTRAINT `llm_analyses_feedback_by_users_id_fk` FOREIGN KEY (`feedback_by`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE no action;