ALTER TABLE `brew_logs` ADD `suggestion_id` varchar(36);--> statement-breakpoint
ALTER TABLE `brew_logs` ADD `suggestion_route` int;--> statement-breakpoint
ALTER TABLE `parameter_suggestions` ADD `routes` json;--> statement-breakpoint
ALTER TABLE `brew_logs` ADD CONSTRAINT `brew_logs_suggestion_id_parameter_suggestions_id_fk` FOREIGN KEY (`suggestion_id`) REFERENCES `parameter_suggestions`(`id`) ON DELETE set null ON UPDATE no action;