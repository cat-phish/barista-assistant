-- Every existing workspace gets the built-in styles for each brewer method
-- (STYLES_BY_KIND), then each recipe's style key becomes a reference to the
-- row for its brewer's method.
INSERT INTO `recipe_styles` (`id`, `workspace_id`, `kind`, `name`, `position`, `hidden`, `builtin`, `brews_like`) SELECT UUID(), `id`, 'filter', 'Pour over', 1, false, 'pour_over', 'pour_over' FROM `workspaces`;--> statement-breakpoint
INSERT INTO `recipe_styles` (`id`, `workspace_id`, `kind`, `name`, `position`, `hidden`, `builtin`, `brews_like`) SELECT UUID(), `id`, 'filter', 'Immersion', 2, false, 'immersion', 'immersion' FROM `workspaces`;--> statement-breakpoint
INSERT INTO `recipe_styles` (`id`, `workspace_id`, `kind`, `name`, `position`, `hidden`, `builtin`, `brews_like`) SELECT UUID(), `id`, 'filter', 'Hybrid', 3, false, 'hybrid', 'hybrid' FROM `workspaces`;--> statement-breakpoint
INSERT INTO `recipe_styles` (`id`, `workspace_id`, `kind`, `name`, `position`, `hidden`, `builtin`, `brews_like`) SELECT UUID(), `id`, 'filter', 'Cold brew', 4, false, 'cold_brew', 'cold_brew' FROM `workspaces`;--> statement-breakpoint
INSERT INTO `recipe_styles` (`id`, `workspace_id`, `kind`, `name`, `position`, `hidden`, `builtin`, `brews_like`) SELECT UUID(), `id`, 'filter', 'Other', 5, false, 'other', 'other' FROM `workspaces`;--> statement-breakpoint
INSERT INTO `recipe_styles` (`id`, `workspace_id`, `kind`, `name`, `position`, `hidden`, `builtin`, `brews_like`) SELECT UUID(), `id`, 'espresso', 'Standard', 1, false, 'standard', 'standard' FROM `workspaces`;--> statement-breakpoint
INSERT INTO `recipe_styles` (`id`, `workspace_id`, `kind`, `name`, `position`, `hidden`, `builtin`, `brews_like`) SELECT UUID(), `id`, 'espresso', 'Soup', 2, false, 'soup', 'soup' FROM `workspaces`;--> statement-breakpoint
INSERT INTO `recipe_styles` (`id`, `workspace_id`, `kind`, `name`, `position`, `hidden`, `builtin`, `brews_like`) SELECT UUID(), `id`, 'espresso', 'Other', 3, false, 'other', 'other' FROM `workspaces`;--> statement-breakpoint
INSERT INTO `recipe_styles` (`id`, `workspace_id`, `kind`, `name`, `position`, `hidden`, `builtin`, `brews_like`) SELECT UUID(), `id`, 'stovetop', 'Moka', 1, false, 'moka', 'moka' FROM `workspaces`;--> statement-breakpoint
INSERT INTO `recipe_styles` (`id`, `workspace_id`, `kind`, `name`, `position`, `hidden`, `builtin`, `brews_like`) SELECT UUID(), `id`, 'stovetop', 'Ibrik', 2, false, 'ibrik', 'ibrik' FROM `workspaces`;--> statement-breakpoint
INSERT INTO `recipe_styles` (`id`, `workspace_id`, `kind`, `name`, `position`, `hidden`, `builtin`, `brews_like`) SELECT UUID(), `id`, 'stovetop', 'Other', 3, false, 'other', 'other' FROM `workspaces`;--> statement-breakpoint
INSERT INTO `recipe_styles` (`id`, `workspace_id`, `kind`, `name`, `position`, `hidden`, `builtin`, `brews_like`) SELECT UUID(), `id`, 'other', 'Other', 1, false, 'other', 'other' FROM `workspaces`;--> statement-breakpoint
UPDATE `recipes` r JOIN `brewers` b ON b.`id` = r.`brewer_id` JOIN `recipe_styles` s ON s.`workspace_id` = r.`workspace_id` AND s.`kind` = b.`kind` AND s.`builtin` = r.`style` SET r.`style_id` = s.`id` WHERE r.`style` IS NOT NULL;
