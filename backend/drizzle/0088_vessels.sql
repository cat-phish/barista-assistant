CREATE TABLE `vessels` (
	`id` varchar(36) NOT NULL,
	`workspace_id` varchar(36) NOT NULL,
	`name` varchar(100) NOT NULL,
	`weight_grams` decimal(6,2) NOT NULL,
	`archived_at` timestamp,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `vessels_id` PRIMARY KEY(`id`),
	CONSTRAINT `vessels_workspace_name_unique` UNIQUE(`workspace_id`,`name`)
);
--> statement-breakpoint
ALTER TABLE `brew_logs` ADD `vessel_id` varchar(36);--> statement-breakpoint
ALTER TABLE `brew_logs` ADD `vessel_weight_grams` decimal(6,2);--> statement-breakpoint
ALTER TABLE `vessels` ADD CONSTRAINT `vessels_workspace_id_workspaces_id_fk` FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `brew_logs` ADD CONSTRAINT `brew_logs_vessel_id_vessels_id_fk` FOREIGN KEY (`vessel_id`) REFERENCES `vessels`(`id`) ON DELETE set null ON UPDATE no action;