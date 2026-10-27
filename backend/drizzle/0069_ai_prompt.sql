ALTER TABLE `parameter_suggestions` ADD `requested_by` varchar(36);--> statement-breakpoint
ALTER TABLE `parameter_suggestions` ADD `note` varchar(500);--> statement-breakpoint
ALTER TABLE `users` ADD `ai_prompt` json;--> statement-breakpoint
ALTER TABLE `parameter_suggestions` ADD CONSTRAINT `parameter_suggestions_requested_by_users_id_fk` FOREIGN KEY (`requested_by`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE no action;