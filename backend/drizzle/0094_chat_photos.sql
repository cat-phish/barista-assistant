CREATE TABLE `ai_chat_photos` (
	`id` varchar(36) NOT NULL,
	`workspace_id` varchar(36) NOT NULL,
	`user_id` varchar(36) NOT NULL,
	`message_id` varchar(36),
	`width` int NOT NULL,
	`height` int NOT NULL,
	`size_bytes` int NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `ai_chat_photos_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `ai_chat_photos` ADD CONSTRAINT `ai_chat_photos_workspace_id_workspaces_id_fk` FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `ai_chat_photos` ADD CONSTRAINT `ai_chat_photos_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `ai_chat_photos` ADD CONSTRAINT `ai_chat_photos_message_id_ai_chat_messages_id_fk` FOREIGN KEY (`message_id`) REFERENCES `ai_chat_messages`(`id`) ON DELETE cascade ON UPDATE no action;