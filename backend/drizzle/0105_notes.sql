CREATE TABLE `notes` (
	`id` varchar(36) NOT NULL,
	`workspace_id` varchar(36) NOT NULL,
	`title` varchar(100) NOT NULL,
	`body` mediumtext NOT NULL,
	`pinned_at` timestamp,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `notes_id` PRIMARY KEY(`id`),
	CONSTRAINT `notes_workspace_title_unique` UNIQUE(`workspace_id`,`title`)
);
--> statement-breakpoint
ALTER TABLE `notes` ADD CONSTRAINT `notes_workspace_id_workspaces_id_fk` FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON DELETE cascade ON UPDATE no action;