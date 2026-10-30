-- Every existing workspace gets the built-in processes (DEFAULT_BEAN_PROCESSES),
-- then each bean's process key becomes a reference to its workspace's row.
INSERT INTO `bean_processes` (`id`, `workspace_id`, `name`, `position`, `hidden`, `builtin`) SELECT UUID(), `id`, 'Washed', 1, false, 'washed' FROM `workspaces`;--> statement-breakpoint
INSERT INTO `bean_processes` (`id`, `workspace_id`, `name`, `position`, `hidden`, `builtin`) SELECT UUID(), `id`, 'Natural', 2, false, 'natural' FROM `workspaces`;--> statement-breakpoint
INSERT INTO `bean_processes` (`id`, `workspace_id`, `name`, `position`, `hidden`, `builtin`) SELECT UUID(), `id`, 'Wet-Hulled', 3, false, 'wet_hulled' FROM `workspaces`;--> statement-breakpoint
INSERT INTO `bean_processes` (`id`, `workspace_id`, `name`, `position`, `hidden`, `builtin`) SELECT UUID(), `id`, 'Honey', 4, false, 'honey' FROM `workspaces`;--> statement-breakpoint
INSERT INTO `bean_processes` (`id`, `workspace_id`, `name`, `position`, `hidden`, `builtin`) SELECT UUID(), `id`, 'Mechanically Washed', 5, false, 'mechanically_washed' FROM `workspaces`;--> statement-breakpoint
INSERT INTO `bean_processes` (`id`, `workspace_id`, `name`, `position`, `hidden`, `builtin`) SELECT UUID(), `id`, 'Anaerobic Fermentation', 6, false, 'anaerobic' FROM `workspaces`;--> statement-breakpoint
INSERT INTO `bean_processes` (`id`, `workspace_id`, `name`, `position`, `hidden`, `builtin`) SELECT UUID(), `id`, 'Carbonic Maceration', 7, false, 'carbonic_maceration' FROM `workspaces`;--> statement-breakpoint
INSERT INTO `bean_processes` (`id`, `workspace_id`, `name`, `position`, `hidden`, `builtin`) SELECT UUID(), `id`, 'Co-Fermentation', 8, false, 'co_fermentation' FROM `workspaces`;--> statement-breakpoint
INSERT INTO `bean_processes` (`id`, `workspace_id`, `name`, `position`, `hidden`, `builtin`) SELECT UUID(), `id`, 'Thermal Shock', 9, false, 'thermal_shock' FROM `workspaces`;--> statement-breakpoint
INSERT INTO `bean_processes` (`id`, `workspace_id`, `name`, `position`, `hidden`, `builtin`) SELECT UUID(), `id`, 'Lactic Fermentation', 10, false, 'lactic' FROM `workspaces`;--> statement-breakpoint
UPDATE `beans` b JOIN `bean_processes` p ON p.`workspace_id` = b.`workspace_id` AND p.`builtin` = b.`process` SET b.`process_id` = p.`id` WHERE b.`process` IS NOT NULL;
