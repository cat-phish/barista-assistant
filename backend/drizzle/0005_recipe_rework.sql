-- Recipe rework (hand-written: the generated version dropped and re-added
-- renamed columns, losing data). Moves existing values to their new homes:
--   recipes.target_yield_grams        -> recipes.target_water_grams (was water)
--   recipes.target_grind_setting      -> recipe_grind_settings, for the grinder
--                                        brews actually used with that setting
--   recipe_steps.action_name          -> step_type (inferred) + label
--   recipe_steps.target_time_sec      -> end_sec; start_sec = previous step's end
--   brew_logs.actual_yield_grams      -> actual_water_grams (was water); the new
--                                        actual_yield_grams (measured) starts empty

CREATE TABLE `recipe_grind_settings` (
	`id` varchar(36) NOT NULL,
	`recipe_id` varchar(36) NOT NULL,
	`grinder_id` varchar(36) NOT NULL,
	`setting` varchar(100) NOT NULL,
	CONSTRAINT `recipe_grind_settings_id` PRIMARY KEY(`id`),
	CONSTRAINT `recipe_grind_settings_recipe_grinder_unique` UNIQUE(`recipe_id`,`grinder_id`)
);
--> statement-breakpoint
ALTER TABLE `recipe_grind_settings` ADD CONSTRAINT `recipe_grind_settings_recipe_id_recipes_id_fk` FOREIGN KEY (`recipe_id`) REFERENCES `recipes`(`id`) ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE `recipe_grind_settings` ADD CONSTRAINT `recipe_grind_settings_grinder_id_grinders_id_fk` FOREIGN KEY (`grinder_id`) REFERENCES `grinders`(`id`) ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE `recipes` ADD `target_water_grams` decimal(6,2);
--> statement-breakpoint
UPDATE `recipes` SET `target_water_grams` = `target_yield_grams`;
--> statement-breakpoint
ALTER TABLE `recipes` MODIFY COLUMN `target_water_grams` decimal(6,2) NOT NULL;
--> statement-breakpoint
ALTER TABLE `recipes` ADD `expected_yield_grams` decimal(6,2);
--> statement-breakpoint
ALTER TABLE `recipes` ADD `expected_finish_sec` int;
--> statement-breakpoint
-- Old grind target -> starting point for the grinder it was used on: the
-- newest brew of this recipe with exactly that setting and a recorded grinder.
INSERT INTO `recipe_grind_settings` (`id`, `recipe_id`, `grinder_id`, `setting`)
SELECT UUID(), r.`id`,
  (SELECT l.`grinder_id` FROM `brew_logs` l
    WHERE l.`recipe_id` = r.`id` AND l.`actual_grind_setting` = r.`target_grind_setting` AND l.`grinder_id` IS NOT NULL
    ORDER BY l.`timestamp` DESC LIMIT 1),
  r.`target_grind_setting`
FROM `recipes` r
WHERE r.`target_grind_setting` IS NOT NULL AND EXISTS (
  SELECT 1 FROM `brew_logs` l
  WHERE l.`recipe_id` = r.`id` AND l.`actual_grind_setting` = r.`target_grind_setting` AND l.`grinder_id` IS NOT NULL);
--> statement-breakpoint
ALTER TABLE `recipes` DROP COLUMN `target_yield_grams`;
--> statement-breakpoint
ALTER TABLE `recipes` DROP COLUMN `target_grind_setting`;
--> statement-breakpoint
ALTER TABLE `recipe_steps` ADD `step_type` varchar(20);
--> statement-breakpoint
ALTER TABLE `recipe_steps` ADD `label` varchar(255);
--> statement-breakpoint
ALTER TABLE `recipe_steps` ADD `start_sec` int;
--> statement-breakpoint
ALTER TABLE `recipe_steps` ADD `end_sec` int;
--> statement-breakpoint
-- Type inferred from the old name; the name is kept as a label unless it's
-- just the type's own name.
UPDATE `recipe_steps` SET
  `step_type` = CASE
    WHEN LOWER(`action_name`) LIKE '%bloom%' THEN 'bloom'
    WHEN LOWER(`action_name`) LIKE '%swirl%' THEN 'swirl'
    WHEN LOWER(`action_name`) LIKE '%stir%' THEN 'stir'
    WHEN LOWER(`action_name`) LIKE '%press%' OR LOWER(`action_name`) LIKE '%plunge%' THEN 'press'
    WHEN LOWER(`action_name`) LIKE '%drawdown%' OR LOWER(`action_name`) LIKE '%wait%' THEN 'wait'
    ELSE 'pour' END,
  `label` = CASE WHEN LOWER(TRIM(`action_name`)) IN ('bloom', 'pour', 'swirl', 'stir', 'press', 'wait', 'drawdown') THEN NULL ELSE `action_name` END,
  `end_sec` = `target_time_sec`;
--> statement-breakpoint
-- Old steps ran back to back: each starts where the previous one ended.
UPDATE `recipe_steps` s
JOIN (
  SELECT `id`, COALESCE(LAG(`target_time_sec`) OVER (PARTITION BY `recipe_id` ORDER BY `step_order`), 0) AS prev_end
  FROM `recipe_steps`
) p ON p.`id` = s.`id`
SET s.`start_sec` = p.prev_end;
--> statement-breakpoint
ALTER TABLE `recipe_steps` MODIFY COLUMN `target_water_grams` decimal(6,2);
--> statement-breakpoint
UPDATE `recipe_steps` SET `target_water_grams` = NULL WHERE `step_type` IN ('swirl', 'stir', 'press', 'wait');
--> statement-breakpoint
ALTER TABLE `recipe_steps` MODIFY COLUMN `step_type` varchar(20) NOT NULL;
--> statement-breakpoint
ALTER TABLE `recipe_steps` MODIFY COLUMN `start_sec` int NOT NULL;
--> statement-breakpoint
ALTER TABLE `recipe_steps` MODIFY COLUMN `end_sec` int NOT NULL;
--> statement-breakpoint
ALTER TABLE `recipe_steps` DROP COLUMN `action_name`;
--> statement-breakpoint
ALTER TABLE `recipe_steps` DROP COLUMN `target_time_sec`;
--> statement-breakpoint
-- Brew logs: the old "yield" was the water poured; measured yield starts empty.
ALTER TABLE `brew_logs` ADD `actual_water_grams` decimal(6,2);
--> statement-breakpoint
UPDATE `brew_logs` SET `actual_water_grams` = `actual_yield_grams`;
--> statement-breakpoint
ALTER TABLE `brew_logs` MODIFY COLUMN `actual_water_grams` decimal(6,2) NOT NULL;
--> statement-breakpoint
ALTER TABLE `brew_logs` MODIFY COLUMN `actual_yield_grams` decimal(6,2);
--> statement-breakpoint
UPDATE `brew_logs` SET `actual_yield_grams` = NULL;
