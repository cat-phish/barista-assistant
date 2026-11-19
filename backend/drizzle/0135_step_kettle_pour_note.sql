ALTER TABLE `recipe_steps` ADD `kettle_set_c` decimal(4,1);--> statement-breakpoint
ALTER TABLE `recipe_steps` ADD `pour_style` varchar(20);--> statement-breakpoint
ALTER TABLE `recipe_steps` ADD `pour_rate_gs` decimal(4,1);--> statement-breakpoint
ALTER TABLE `recipe_steps` ADD `note_before` varchar(255);--> statement-breakpoint
ALTER TABLE `recipe_steps` ADD `note_after` varchar(255);--> statement-breakpoint
-- A wait step's temperature meant "set the kettle to" (docs/api/recipes.md §5).
UPDATE `recipe_steps` SET `kettle_set_c` = `target_temp_c`, `target_temp_c` = NULL WHERE `step_type` = 'wait' AND `target_temp_c` IS NOT NULL;
