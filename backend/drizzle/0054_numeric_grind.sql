ALTER TABLE `brew_logs` MODIFY COLUMN `actual_grind_setting` decimal(6,2);--> statement-breakpoint
ALTER TABLE `recipe_grind_settings` MODIFY COLUMN `setting` decimal(6,2) NOT NULL;