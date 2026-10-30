ALTER TABLE `brew_logs` ADD `grind_rpm` int;--> statement-breakpoint
ALTER TABLE `grinders` ADD `variable_speed` boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `grinders` ADD `rpm_min` int;--> statement-breakpoint
ALTER TABLE `grinders` ADD `rpm_max` int;