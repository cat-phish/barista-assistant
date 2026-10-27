CREATE TABLE `parameter_suggestions` (
	`id` varchar(36) NOT NULL,
	`bean_id` varchar(36) NOT NULL,
	`recipe_id` varchar(36),
	`brewer_id` varchar(36),
	`grinder_id` varchar(36),
	`source` varchar(20) NOT NULL,
	`max_brews` int NOT NULL,
	`brew_count` int,
	`batch_dose_grams` decimal(5,1),
	`batch_water_grams` decimal(6,1),
	`batch_ice_grams` decimal(6,1),
	`batch_yield_grams` decimal(6,1),
	`status` varchar(10) NOT NULL DEFAULT 'pending',
	`error` varchar(200),
	`reasoning` text,
	`next_step` varchar(200),
	`confidence` varchar(10),
	`grind_setting` decimal(6,2),
	`grind_rpm` int,
	`temp_c` decimal(4,1),
	`ratio` decimal(5,2),
	`model` varchar(100),
	`prompt_version` varchar(30),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`completed_at` timestamp,
	CONSTRAINT `parameter_suggestions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `parameter_suggestions` ADD CONSTRAINT `parameter_suggestions_bean_id_beans_id_fk` FOREIGN KEY (`bean_id`) REFERENCES `beans`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `parameter_suggestions` ADD CONSTRAINT `parameter_suggestions_recipe_id_recipes_id_fk` FOREIGN KEY (`recipe_id`) REFERENCES `recipes`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `parameter_suggestions` ADD CONSTRAINT `parameter_suggestions_brewer_id_brewers_id_fk` FOREIGN KEY (`brewer_id`) REFERENCES `brewers`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `parameter_suggestions` ADD CONSTRAINT `parameter_suggestions_grinder_id_grinders_id_fk` FOREIGN KEY (`grinder_id`) REFERENCES `grinders`(`id`) ON DELETE set null ON UPDATE no action;