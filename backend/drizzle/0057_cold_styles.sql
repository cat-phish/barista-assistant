ALTER TABLE `recipes` ADD `steep_min_hours` decimal(4,1);--> statement-breakpoint
ALTER TABLE `recipes` ADD `steep_max_hours` decimal(4,1);--> statement-breakpoint
ALTER TABLE `recipes` ADD `steep_temp` varchar(10);--> statement-breakpoint
ALTER TABLE `recipes` ADD `dilution_ratio` decimal(3,1);--> statement-breakpoint
ALTER TABLE `recipes` ADD `dilution_with` varchar(10);--> statement-breakpoint
-- New built-in filter styles for every existing workspace, after its last
-- filter style (new workspaces get them from STYLES_BY_KIND). A workspace
-- that already has a style by that name keeps its own instead.
INSERT INTO `recipe_styles` (`id`, `workspace_id`, `kind`, `name`, `position`, `hidden`, `builtin`, `brews_like`)
SELECT UUID(), w.`id`, 'filter', 'Rapid cold brew',
  COALESCE((SELECT MAX(s.`position`) FROM `recipe_styles` s WHERE s.`workspace_id` = w.`id` AND s.`kind` = 'filter'), 0) + 1,
  false, 'rapid_cold', 'rapid_cold'
FROM `workspaces` w
WHERE NOT EXISTS (SELECT 1 FROM `recipe_styles` s WHERE s.`workspace_id` = w.`id` AND s.`kind` = 'filter' AND s.`name` = 'Rapid cold brew');--> statement-breakpoint
INSERT INTO `recipe_styles` (`id`, `workspace_id`, `kind`, `name`, `position`, `hidden`, `builtin`, `brews_like`)
SELECT UUID(), w.`id`, 'filter', 'Kyoto drip',
  COALESCE((SELECT MAX(s.`position`) FROM `recipe_styles` s WHERE s.`workspace_id` = w.`id` AND s.`kind` = 'filter'), 0) + 1,
  false, 'kyoto_drip', 'kyoto_drip'
FROM `workspaces` w
WHERE NOT EXISTS (SELECT 1 FROM `recipe_styles` s WHERE s.`workspace_id` = w.`id` AND s.`kind` = 'filter' AND s.`name` = 'Kyoto drip');
