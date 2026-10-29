CREATE TABLE `roasts` (
	`id` varchar(36) NOT NULL,
	`workspace_id` varchar(36) NOT NULL,
	`green_coffee_id` varchar(36),
	`machine_id` varchar(36),
	`bean_id` varchar(36),
	`user_id` varchar(36),
	`roasted_at` timestamp NOT NULL,
	`utc_offset_minutes` int,
	`batch_number` varchar(50),
	`green_grams` int NOT NULL,
	`roasted_grams` int NOT NULL,
	`green_stock_taken_grams` int NOT NULL DEFAULT 0,
	`roast_type` varchar(20),
	`detailed_roast_level` varchar(20),
	`roast_level` varchar(20),
	`charge_temp_c` decimal(4,1),
	`drop_temp_c` decimal(4,1),
	`first_crack_sec` int,
	`total_sec` int,
	`rest_days` int NOT NULL,
	`notes` text,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `roasts_id` PRIMARY KEY(`id`),
	CONSTRAINT `roasts_bean_unique` UNIQUE(`bean_id`)
);
--> statement-breakpoint
ALTER TABLE `roasts` ADD CONSTRAINT `roasts_workspace_id_workspaces_id_fk` FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `roasts` ADD CONSTRAINT `roasts_green_coffee_id_green_coffees_id_fk` FOREIGN KEY (`green_coffee_id`) REFERENCES `green_coffees`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `roasts` ADD CONSTRAINT `roasts_machine_id_roasting_machines_id_fk` FOREIGN KEY (`machine_id`) REFERENCES `roasting_machines`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `roasts` ADD CONSTRAINT `roasts_bean_id_beans_id_fk` FOREIGN KEY (`bean_id`) REFERENCES `beans`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `roasts` ADD CONSTRAINT `roasts_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE no action;