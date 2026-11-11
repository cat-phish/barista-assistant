ALTER TABLE `grinders` ADD `starting_setting` decimal(6,2);--> statement-breakpoint
ALTER TABLE `grinders` ADD `starting_points` json;--> statement-breakpoint
ALTER TABLE `grinders` ADD `unavailable_methods` json;