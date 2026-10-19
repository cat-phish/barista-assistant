CREATE TABLE `grinders` (
	`id` varchar(36) NOT NULL,
	`workspace_id` varchar(36) NOT NULL,
	`name` varchar(100) NOT NULL,
	`notes` varchar(255),
	`retired_at` timestamp,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `grinders_id` PRIMARY KEY(`id`),
	CONSTRAINT `grinders_workspace_name_unique` UNIQUE(`workspace_id`,`name`)
);
--> statement-breakpoint
ALTER TABLE `brew_logs` ADD `grinder_id` varchar(36);--> statement-breakpoint
ALTER TABLE `grinders` ADD CONSTRAINT `grinders_workspace_id_workspaces_id_fk` FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `brew_logs` ADD CONSTRAINT `brew_logs_grinder_id_grinders_id_fk` FOREIGN KEY (`grinder_id`) REFERENCES `grinders`(`id`) ON DELETE set null ON UPDATE no action;