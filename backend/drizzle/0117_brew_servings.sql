CREATE TABLE `brew_serving_flavors` (
	`serving_id` varchar(36) NOT NULL,
	`flavor_key` varchar(64) NOT NULL,
	`label` varchar(60) NOT NULL,
	`place` varchar(130),
	CONSTRAINT `brew_serving_flavors_serving_id_flavor_key_pk` PRIMARY KEY(`serving_id`,`flavor_key`)
);
--> statement-breakpoint
CREATE TABLE `brew_servings` (
	`id` varchar(36) NOT NULL,
	`brew_log_id` varchar(36) NOT NULL,
	`user_id` varchar(36),
	`timestamp` timestamp NOT NULL DEFAULT (now()),
	`utc_offset_minutes` int,
	`concentrate_grams` decimal(6,1) NOT NULL,
	`diluent_grams` decimal(6,1),
	`diluted_with` varchar(10),
	`rating` decimal(2,1),
	`tasting_notes` text,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `brew_servings_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `brew_logs` ADD `batch_finished_at` timestamp;--> statement-breakpoint
ALTER TABLE `brew_serving_flavors` ADD CONSTRAINT `brew_serving_flavors_serving_id_brew_servings_id_fk` FOREIGN KEY (`serving_id`) REFERENCES `brew_servings`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `brew_servings` ADD CONSTRAINT `brew_servings_brew_log_id_brew_logs_id_fk` FOREIGN KEY (`brew_log_id`) REFERENCES `brew_logs`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `brew_servings` ADD CONSTRAINT `brew_servings_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `brew_servings_log_idx` ON `brew_servings` (`brew_log_id`,`timestamp`);