CREATE TABLE `notification_channels` (
	`id` varchar(36) NOT NULL,
	`user_id` varchar(36) NOT NULL,
	`kind` varchar(20) NOT NULL,
	`enabled` boolean NOT NULL DEFAULT true,
	`config` json NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `notification_channels_id` PRIMARY KEY(`id`),
	CONSTRAINT `notification_channels_user_kind_unique` UNIQUE(`user_id`,`kind`)
);
--> statement-breakpoint
ALTER TABLE `notification_channels` ADD CONSTRAINT `notification_channels_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;