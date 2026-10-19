CREATE TABLE `beans` (
	`id` varchar(36) NOT NULL,
	`workspace_id` varchar(36) NOT NULL,
	`roaster_name` varchar(255) NOT NULL,
	`bean_name` varchar(255) NOT NULL,
	`process` varchar(100),
	`roast_date` timestamp,
	`inventory_weight_grams` int NOT NULL DEFAULT 0,
	`show_on_public_menu` boolean NOT NULL DEFAULT true,
	CONSTRAINT `beans_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `brew_logs` (
	`id` varchar(36) NOT NULL,
	`workspace_id` varchar(36) NOT NULL,
	`user_id` varchar(36) NOT NULL,
	`bean_id` varchar(36) NOT NULL,
	`recipe_id` varchar(36),
	`timestamp` timestamp NOT NULL DEFAULT (now()),
	`actual_dose_grams` decimal(5,2) NOT NULL,
	`actual_yield_grams` decimal(6,2) NOT NULL,
	`actual_temp_c` decimal(4,1),
	`actual_grind_setting` varchar(100),
	`actual_time_sec` int NOT NULL,
	`rating` int,
	`tasting_notes` text,
	CONSTRAINT `brew_logs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `brew_methods` (
	`id` varchar(36) NOT NULL,
	`workspace_id` varchar(36) NOT NULL,
	`name` varchar(100) NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `brew_methods_id` PRIMARY KEY(`id`),
	CONSTRAINT `brew_methods_workspace_name_unique` UNIQUE(`workspace_id`,`name`)
);
--> statement-breakpoint
CREATE TABLE `llm_analyses` (
	`id` varchar(36) NOT NULL,
	`brew_log_id` varchar(36) NOT NULL,
	`reasoning` text NOT NULL,
	`suggested_grind_delta` varchar(50) NOT NULL,
	`suggested_temp_delta` decimal(3,1) NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `llm_analyses_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `recipe_steps` (
	`id` varchar(36) NOT NULL,
	`recipe_id` varchar(36) NOT NULL,
	`step_order` int NOT NULL,
	`action_name` varchar(255) NOT NULL,
	`target_time_sec` int NOT NULL,
	`target_water_grams` decimal(6,2) NOT NULL,
	CONSTRAINT `recipe_steps_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `recipes` (
	`id` varchar(36) NOT NULL,
	`workspace_id` varchar(36) NOT NULL,
	`name` varchar(255) NOT NULL,
	`method_id` varchar(36) NOT NULL,
	`target_dose_grams` decimal(5,2) NOT NULL,
	`target_yield_grams` decimal(6,2) NOT NULL,
	`target_temp_c` decimal(4,1),
	`target_grind_setting` varchar(100),
	`show_on_public_menu` boolean NOT NULL DEFAULT true,
	CONSTRAINT `recipes_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` varchar(36) NOT NULL,
	`email` varchar(255) NOT NULL,
	`password_hash` varchar(255) NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `users_id` PRIMARY KEY(`id`),
	CONSTRAINT `users_email_unique` UNIQUE(`email`)
);
--> statement-breakpoint
CREATE TABLE `workspace_members` (
	`user_id` varchar(36) NOT NULL,
	`workspace_id` varchar(36) NOT NULL,
	`role` varchar(50) NOT NULL,
	CONSTRAINT `workspace_members_user_id_workspace_id_pk` PRIMARY KEY(`user_id`,`workspace_id`)
);
--> statement-breakpoint
CREATE TABLE `workspaces` (
	`id` varchar(36) NOT NULL,
	`name` varchar(255) NOT NULL,
	`slug` varchar(255) NOT NULL,
	`is_public_menu_enabled` boolean NOT NULL DEFAULT false,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `workspaces_id` PRIMARY KEY(`id`),
	CONSTRAINT `workspaces_slug_unique` UNIQUE(`slug`)
);
--> statement-breakpoint
ALTER TABLE `beans` ADD CONSTRAINT `beans_workspace_id_workspaces_id_fk` FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `brew_logs` ADD CONSTRAINT `brew_logs_workspace_id_workspaces_id_fk` FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `brew_logs` ADD CONSTRAINT `brew_logs_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `brew_logs` ADD CONSTRAINT `brew_logs_bean_id_beans_id_fk` FOREIGN KEY (`bean_id`) REFERENCES `beans`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `brew_logs` ADD CONSTRAINT `brew_logs_recipe_id_recipes_id_fk` FOREIGN KEY (`recipe_id`) REFERENCES `recipes`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `brew_methods` ADD CONSTRAINT `brew_methods_workspace_id_workspaces_id_fk` FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `llm_analyses` ADD CONSTRAINT `llm_analyses_brew_log_id_brew_logs_id_fk` FOREIGN KEY (`brew_log_id`) REFERENCES `brew_logs`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `recipe_steps` ADD CONSTRAINT `recipe_steps_recipe_id_recipes_id_fk` FOREIGN KEY (`recipe_id`) REFERENCES `recipes`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `recipes` ADD CONSTRAINT `recipes_workspace_id_workspaces_id_fk` FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `recipes` ADD CONSTRAINT `recipes_method_id_brew_methods_id_fk` FOREIGN KEY (`method_id`) REFERENCES `brew_methods`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `workspace_members` ADD CONSTRAINT `workspace_members_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `workspace_members` ADD CONSTRAINT `workspace_members_workspace_id_workspaces_id_fk` FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON DELETE cascade ON UPDATE no action;