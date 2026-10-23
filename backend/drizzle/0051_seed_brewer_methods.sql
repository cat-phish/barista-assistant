-- Every existing workspace gets the built-in methods (METHOD_NAMES), then each
-- brewer is put under the built-in method of its kind.
INSERT INTO `brewer_methods` (`id`, `workspace_id`, `name`, `position`, `hidden`, `builtin`, `behaviour`) SELECT UUID(), `id`, 'Filter', 1, false, 'filter', 'filter' FROM `workspaces`;--> statement-breakpoint
INSERT INTO `brewer_methods` (`id`, `workspace_id`, `name`, `position`, `hidden`, `builtin`, `behaviour`) SELECT UUID(), `id`, 'Espresso', 2, false, 'espresso', 'espresso' FROM `workspaces`;--> statement-breakpoint
INSERT INTO `brewer_methods` (`id`, `workspace_id`, `name`, `position`, `hidden`, `builtin`, `behaviour`) SELECT UUID(), `id`, 'Stovetop', 3, false, 'stovetop', 'stovetop' FROM `workspaces`;--> statement-breakpoint
INSERT INTO `brewer_methods` (`id`, `workspace_id`, `name`, `position`, `hidden`, `builtin`, `behaviour`) SELECT UUID(), `id`, 'Other', 4, false, 'other', 'other' FROM `workspaces`;--> statement-breakpoint
UPDATE `brewers` b JOIN `brewer_methods` m ON m.`workspace_id` = b.`workspace_id` AND m.`builtin` = b.`kind` SET b.`method_id` = m.`id`;
