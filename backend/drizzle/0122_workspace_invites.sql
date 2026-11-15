CREATE TABLE `workspace_invites` (
	`id` varchar(36) NOT NULL,
	`workspace_id` varchar(36) NOT NULL,
	`email` varchar(255) NOT NULL,
	`role` varchar(50) NOT NULL,
	`invited_by` varchar(36),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `workspace_invites_id` PRIMARY KEY(`id`),
	CONSTRAINT `workspace_invites_workspace_email` UNIQUE(`workspace_id`,`email`)
);
--> statement-breakpoint
ALTER TABLE `workspace_invites` ADD CONSTRAINT `workspace_invites_workspace_id_workspaces_id_fk` FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `workspace_invites` ADD CONSTRAINT `workspace_invites_invited_by_users_id_fk` FOREIGN KEY (`invited_by`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `workspace_invites_email` ON `workspace_invites` (`email`);