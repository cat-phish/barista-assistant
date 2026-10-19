ALTER TABLE `brew_logs` DROP FOREIGN KEY `brew_logs_user_id_users_id_fk`;
--> statement-breakpoint
ALTER TABLE `brew_logs` MODIFY COLUMN `user_id` varchar(36);--> statement-breakpoint
ALTER TABLE `users` ADD `session_version` int DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `brew_logs` ADD CONSTRAINT `brew_logs_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE no action;