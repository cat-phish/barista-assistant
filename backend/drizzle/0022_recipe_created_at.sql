-- Recipes get a "date added" for sorting lists (docs/roadmap.md). Hand-written
-- backfill: an existing recipe dates from its first brew, else now.
ALTER TABLE `recipes` ADD `created_at` timestamp DEFAULT (now()) NOT NULL;--> statement-breakpoint
UPDATE `recipes` r
JOIN (SELECT `recipe_id`, MIN(`timestamp`) AS `first_brew` FROM `brew_logs` WHERE `recipe_id` IS NOT NULL GROUP BY `recipe_id`) b ON b.`recipe_id` = r.`id`
SET r.`created_at` = LEAST(r.`created_at`, b.`first_brew`);
