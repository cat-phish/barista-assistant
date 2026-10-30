CREATE TABLE `bean_processes` (
	`id` varchar(36) NOT NULL,
	`workspace_id` varchar(36) NOT NULL,
	`name` varchar(100) NOT NULL,
	`position` int NOT NULL,
	`hidden` boolean NOT NULL DEFAULT false,
	`builtin` varchar(30),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `bean_processes_id` PRIMARY KEY(`id`),
	CONSTRAINT `bean_processes_workspace_name` UNIQUE(`workspace_id`,`name`)
);
--> statement-breakpoint
ALTER TABLE `beans` ADD `process_id` varchar(36);--> statement-breakpoint
ALTER TABLE `bean_processes` ADD CONSTRAINT `bean_processes_workspace_id_workspaces_id_fk` FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `beans` ADD CONSTRAINT `beans_process_id_bean_processes_id_fk` FOREIGN KEY (`process_id`) REFERENCES `bean_processes`(`id`) ON DELETE set null ON UPDATE no action;