CREATE TABLE `brew_log_tools` (
	`brew_log_id` varchar(36) NOT NULL,
	`tool_id` varchar(36) NOT NULL,
	CONSTRAINT `brew_log_tools_brew_log_id_tool_id_pk` PRIMARY KEY(`brew_log_id`,`tool_id`)
);
--> statement-breakpoint
CREATE TABLE `prep_tools` (
	`id` varchar(36) NOT NULL,
	`workspace_id` varchar(36) NOT NULL,
	`name` varchar(100) NOT NULL,
	`method_kind` varchar(20),
	`position` int NOT NULL,
	`retired_at` timestamp,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `prep_tools_id` PRIMARY KEY(`id`),
	CONSTRAINT `prep_tools_workspace_name_unique` UNIQUE(`workspace_id`,`name`)
);
--> statement-breakpoint
ALTER TABLE `brew_log_tools` ADD CONSTRAINT `brew_log_tools_brew_log_id_brew_logs_id_fk` FOREIGN KEY (`brew_log_id`) REFERENCES `brew_logs`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `brew_log_tools` ADD CONSTRAINT `brew_log_tools_tool_id_prep_tools_id_fk` FOREIGN KEY (`tool_id`) REFERENCES `prep_tools`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `prep_tools` ADD CONSTRAINT `prep_tools_workspace_id_workspaces_id_fk` FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- Seed every existing workspace with DEFAULT_PREP_TOOLS (new ones get them on create).
INSERT INTO `prep_tools` (`id`, `workspace_id`, `name`, `method_kind`, `position`)
SELECT UUID(), w.`id`, t.`name`, t.`method_kind`, t.`position`
FROM `workspaces` w
CROSS JOIN (
	SELECT 'WDT' AS `name`, 'espresso' AS `method_kind`, 1 AS `position`
	UNION ALL SELECT 'Puck screen' AS `name`, 'espresso' AS `method_kind`, 2 AS `position`
	UNION ALL SELECT 'Distributor' AS `name`, 'espresso' AS `method_kind`, 3 AS `position`
	UNION ALL SELECT 'Shaker' AS `name`, 'espresso' AS `method_kind`, 4 AS `position`
	UNION ALL SELECT 'Bottom paper filter' AS `name`, 'espresso' AS `method_kind`, 5 AS `position`
	UNION ALL SELECT 'Top paper filter' AS `name`, 'espresso' AS `method_kind`, 6 AS `position`
	UNION ALL SELECT 'Rinsed paper filter' AS `name`, 'filter' AS `method_kind`, 7 AS `position`
	UNION ALL SELECT 'Metal filter' AS `name`, 'filter' AS `method_kind`, 8 AS `position`
	UNION ALL SELECT 'Cloth filter' AS `name`, 'filter' AS `method_kind`, 9 AS `position`
	UNION ALL SELECT 'RDT' AS `name`, NULL AS `method_kind`, 10 AS `position`
	UNION ALL SELECT 'Sifted fines' AS `name`, NULL AS `method_kind`, 11 AS `position`
) t;
