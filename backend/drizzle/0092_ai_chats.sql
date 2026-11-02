CREATE TABLE `ai_chat_messages` (
	`id` varchar(36) NOT NULL,
	`chat_id` varchar(36) NOT NULL,
	`position` int NOT NULL,
	`role` varchar(10) NOT NULL,
	`content` mediumtext NOT NULL,
	`status` varchar(10) NOT NULL,
	`error` varchar(200),
	`model` varchar(100),
	`prompt_tokens` int,
	`completion_tokens` int,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `ai_chat_messages_id` PRIMARY KEY(`id`),
	CONSTRAINT `ai_chat_messages_position` UNIQUE(`chat_id`,`position`)
);
--> statement-breakpoint
CREATE TABLE `ai_chats` (
	`id` varchar(36) NOT NULL,
	`workspace_id` varchar(36) NOT NULL,
	`user_id` varchar(36) NOT NULL,
	`title` varchar(120) NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `ai_chats_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `ai_chat_messages` ADD CONSTRAINT `ai_chat_messages_chat_id_ai_chats_id_fk` FOREIGN KEY (`chat_id`) REFERENCES `ai_chats`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `ai_chats` ADD CONSTRAINT `ai_chats_workspace_id_workspaces_id_fk` FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `ai_chats` ADD CONSTRAINT `ai_chats_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `ai_chats_owner_idx` ON `ai_chats` (`workspace_id`,`user_id`,`updated_at`);