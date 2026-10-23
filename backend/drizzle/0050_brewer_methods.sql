CREATE TABLE `brewer_methods` (
	`id` varchar(36) NOT NULL,
	`workspace_id` varchar(36) NOT NULL,
	`name` varchar(100) NOT NULL,
	`position` int NOT NULL,
	`hidden` boolean NOT NULL DEFAULT false,
	`builtin` varchar(20),
	`behaviour` varchar(20) NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `brewer_methods_id` PRIMARY KEY(`id`),
	CONSTRAINT `brewer_methods_workspace_name` UNIQUE(`workspace_id`,`name`)
);
--> statement-breakpoint
ALTER TABLE `brewers` ADD `method_id` varchar(36);--> statement-breakpoint
ALTER TABLE `brewer_methods` ADD CONSTRAINT `brewer_methods_workspace_id_workspaces_id_fk` FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `brewers` ADD CONSTRAINT `brewers_method_id_brewer_methods_id_fk` FOREIGN KEY (`method_id`) REFERENCES `brewer_methods`(`id`) ON DELETE set null ON UPDATE no action;