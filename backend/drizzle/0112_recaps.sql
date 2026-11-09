CREATE TABLE `recaps` (
	`id` varchar(36) NOT NULL,
	`workspace_id` varchar(36) NOT NULL,
	`user_id` varchar(36) NOT NULL,
	`kind` varchar(10) NOT NULL,
	`period_start` date NOT NULL,
	`scope` varchar(4) NOT NULL,
	`status` varchar(10) NOT NULL DEFAULT 'none',
	`summary` text,
	`error` text,
	`model` varchar(120),
	`prompt_version` varchar(40),
	`prompt_tokens` int,
	`completion_tokens` int,
	`notified_at` timestamp,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `recaps_id` PRIMARY KEY(`id`),
	CONSTRAINT `recaps_period_uq` UNIQUE(`workspace_id`,`user_id`,`kind`,`period_start`,`scope`)
);
--> statement-breakpoint
ALTER TABLE `recaps` ADD CONSTRAINT `recaps_workspace_id_workspaces_id_fk` FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `recaps` ADD CONSTRAINT `recaps_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;