ALTER TABLE `grinders` ADD COLUMN IF NOT EXISTS `starting_setting` decimal(6,2);--> statement-breakpoint
ALTER TABLE `grinders` ADD COLUMN IF NOT EXISTS `starting_points` json;--> statement-breakpoint
ALTER TABLE `grinders` ADD COLUMN IF NOT EXISTS `unavailable_methods` json;