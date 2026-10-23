ALTER TABLE `brew_logs` ADD `steep_min_hours` decimal(4,1);--> statement-breakpoint
ALTER TABLE `brew_logs` ADD `steep_max_hours` decimal(4,1);--> statement-breakpoint
ALTER TABLE `brew_logs` ADD `expected_finish_min_sec` int;--> statement-breakpoint
ALTER TABLE `brew_logs` ADD `expected_finish_max_sec` int;--> statement-breakpoint
UPDATE `brew_logs` bl JOIN `recipes` r ON r.`id` = bl.`recipe_id` SET bl.`steep_min_hours` = r.`steep_min_hours`, bl.`steep_max_hours` = r.`steep_max_hours` WHERE r.`steep_min_hours` IS NOT NULL AND r.`steep_max_hours` IS NOT NULL;
