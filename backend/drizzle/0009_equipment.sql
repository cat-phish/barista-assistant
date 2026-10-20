CREATE TABLE `machines` (
	`id` varchar(36) NOT NULL,
	`workspace_id` varchar(36) NOT NULL,
	`name` varchar(100) NOT NULL,
	`notes` varchar(255),
	`preinfusion` varchar(20) NOT NULL DEFAULT 'none',
	`flow_control` varchar(20) NOT NULL DEFAULT 'none',
	`pressure_control` varchar(20) NOT NULL DEFAULT 'none',
	`retired_at` timestamp,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `machines_id` PRIMARY KEY(`id`),
	CONSTRAINT `machines_workspace_name_unique` UNIQUE(`workspace_id`,`name`)
);
--> statement-breakpoint
ALTER TABLE `brew_logs` ADD `machine_id` varchar(36);--> statement-breakpoint
ALTER TABLE `grinders` ADD `adjustment` varchar(20);--> statement-breakpoint
ALTER TABLE `grinders` ADD `setting_min` decimal(6,2);--> statement-breakpoint
ALTER TABLE `grinders` ADD `setting_max` decimal(6,2);--> statement-breakpoint
ALTER TABLE `grinders` ADD `step_size` decimal(5,2);--> statement-breakpoint
ALTER TABLE `grinders` ADD `burr_type` varchar(20);--> statement-breakpoint
ALTER TABLE `grinders` ADD `burr_size_mm` int;--> statement-breakpoint
ALTER TABLE `grinders` ADD `power` varchar(20);--> statement-breakpoint
ALTER TABLE `machines` ADD CONSTRAINT `machines_workspace_id_workspaces_id_fk` FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `brew_logs` ADD CONSTRAINT `brew_logs_machine_id_machines_id_fk` FOREIGN KEY (`machine_id`) REFERENCES `machines`(`id`) ON DELETE set null ON UPDATE no action;