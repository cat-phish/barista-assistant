ALTER TABLE `brew_logs` ADD COLUMN IF NOT EXISTS `target_dose_grams` decimal(5,2);--> statement-breakpoint
ALTER TABLE `brew_logs` ADD COLUMN IF NOT EXISTS `target_water_grams` decimal(6,2);--> statement-breakpoint
ALTER TABLE `brew_logs` ADD COLUMN IF NOT EXISTS `target_ice_grams` decimal(6,2);