CREATE TABLE `bean_photos` (
	`id` varchar(36) NOT NULL,
	`bean_id` varchar(36) NOT NULL,
	`position` int NOT NULL,
	`width` int NOT NULL,
	`height` int NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `bean_photos_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `bean_photos` ADD CONSTRAINT `bean_photos_bean_id_beans_id_fk` FOREIGN KEY (`bean_id`) REFERENCES `beans`(`id`) ON DELETE cascade ON UPDATE no action;