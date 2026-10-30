ALTER TABLE `brew_log_marks` ADD `step_order` int;--> statement-breakpoint
ALTER TABLE `recipe_steps` ADD `duration_sec` int;--> statement-breakpoint
ALTER TABLE `recipe_steps` ADD `advance` varchar(20) DEFAULT 'auto' NOT NULL;--> statement-breakpoint
ALTER TABLE `recipe_steps` ADD `target_temp_c` decimal(4,1);--> statement-breakpoint
ALTER TABLE `recipe_steps` ADD `pressure_bar` decimal(4,1);--> statement-breakpoint
ALTER TABLE `recipe_steps` ADD `pressure_end_bar` decimal(4,1);--> statement-breakpoint
ALTER TABLE `recipe_steps` ADD `flow_rate` decimal(4,1);--> statement-breakpoint
ALTER TABLE `recipe_steps` ADD `flow_end_rate` decimal(4,1);--> statement-breakpoint
ALTER TABLE `recipes` ADD `flow_unit` varchar(10) DEFAULT 'g_s' NOT NULL;--> statement-breakpoint
-- Steps run back to back (docs/roadmap.md 2d). Hand-written data conversion:
-- each step's duration is its old end - start; every gap before a step (or
-- before the first one) becomes an explicit 'wait' step; steps are then
-- renumbered in time order. Old 'preinfusion_end' marks are dropped (none were
-- recorded outside tests).
UPDATE `recipe_steps` SET `duration_sec` = `end_sec` - `start_sec`;--> statement-breakpoint
INSERT INTO `recipe_steps` (`id`, `recipe_id`, `step_order`, `step_type`, `label`, `start_sec`, `end_sec`, `duration_sec`, `advance`)
SELECT UUID(), g.`recipe_id`, 0, 'wait', NULL, g.`prev_end`, g.`start_sec`, g.`start_sec` - g.`prev_end`, 'auto'
FROM (
  SELECT `recipe_id`, `start_sec`,
    COALESCE(LAG(`end_sec`) OVER (PARTITION BY `recipe_id` ORDER BY `step_order`), 0) AS `prev_end`
  FROM `recipe_steps`
) g
WHERE g.`start_sec` > g.`prev_end`;--> statement-breakpoint
UPDATE `recipe_steps` rs
JOIN (
  SELECT `id`, ROW_NUMBER() OVER (PARTITION BY `recipe_id` ORDER BY `start_sec`, `end_sec`, `step_order`) AS `rn`
  FROM `recipe_steps`
) o ON o.`id` = rs.`id`
SET rs.`step_order` = o.`rn`;--> statement-breakpoint
DELETE FROM `brew_log_marks` WHERE `kind` = 'preinfusion_end';--> statement-breakpoint
ALTER TABLE `recipe_steps` DROP COLUMN `start_sec`;--> statement-breakpoint
ALTER TABLE `recipe_steps` DROP COLUMN `end_sec`;