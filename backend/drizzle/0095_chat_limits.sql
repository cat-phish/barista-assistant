ALTER TABLE `users` ADD `chat_limits` json;--> statement-breakpoint
ALTER TABLE `workspace_members` ADD `chat_enabled` boolean DEFAULT true NOT NULL;