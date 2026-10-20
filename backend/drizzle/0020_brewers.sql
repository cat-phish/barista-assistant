-- Brew methods and espresso machines merge into brewers (docs/roadmap.md).
-- Hand-written data steps: each method becomes a brewer (same id), and each
-- machine an espresso brewer with its capabilities. Where a workspace has one
-- active machine and one espresso method, the machine takes over the method's
-- recipes, drinks, brews and menu settings (shown on the menu under the
-- method's name) and the method goes. Brew logs record their brewer: the
-- machine used, else the recipe's. 0021 drops brew_methods and machines.
CREATE TABLE `brewers` (
	`id` varchar(36) NOT NULL,
	`workspace_id` varchar(36) NOT NULL,
	`name` varchar(100) NOT NULL,
	`kind` varchar(20) NOT NULL DEFAULT 'pour_over',
	`notes` varchar(255),
	`preinfusion` varchar(20) NOT NULL DEFAULT 'none',
	`flow_control` varchar(20) NOT NULL DEFAULT 'none',
	`pressure_control` varchar(20) NOT NULL DEFAULT 'none',
	`menu_name` varchar(100),
	`description` varchar(500),
	`category_id` varchar(36),
	`show_on_public_menu` boolean NOT NULL DEFAULT false,
	`retired_at` timestamp,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `brewers_id` PRIMARY KEY(`id`),
	CONSTRAINT `brewers_workspace_name_unique` UNIQUE(`workspace_id`,`name`)
);
--> statement-breakpoint
ALTER TABLE `brew_logs` ADD `brewer_id` varchar(36);--> statement-breakpoint
ALTER TABLE `drinks` ADD `brewer_id` varchar(36);--> statement-breakpoint
ALTER TABLE `recipes` ADD `brewer_id` varchar(36);--> statement-breakpoint
INSERT INTO `brewers` (`id`, `workspace_id`, `name`, `kind`, `description`, `category_id`, `show_on_public_menu`, `created_at`)
SELECT `id`, `workspace_id`, `name`, `kind`, `description`, `category_id`, `show_on_public_menu`, `created_at` FROM `brew_methods`;--> statement-breakpoint
INSERT INTO `brewers` (`id`, `workspace_id`, `name`, `kind`, `notes`, `preinfusion`, `flow_control`, `pressure_control`, `retired_at`, `created_at`)
SELECT m.`id`, m.`workspace_id`,
	IF(EXISTS (SELECT 1 FROM `brew_methods` b WHERE b.`workspace_id` = m.`workspace_id` AND b.`name` = m.`name`), CONCAT(LEFT(m.`name`, 90), ' (machine)'), m.`name`),
	'espresso', m.`notes`, m.`preinfusion`, m.`flow_control`, m.`pressure_control`, m.`retired_at`, m.`created_at`
FROM `machines` m;--> statement-breakpoint
UPDATE `recipes` SET `brewer_id` = `method_id`;--> statement-breakpoint
UPDATE `drinks` SET `brewer_id` = `method_id`;--> statement-breakpoint
UPDATE `brew_logs` l LEFT JOIN `recipes` r ON r.`id` = l.`recipe_id` SET l.`brewer_id` = COALESCE(l.`machine_id`, r.`brewer_id`);--> statement-breakpoint
UPDATE `brewers` mach
JOIN `machines` m ON m.`id` = mach.`id` AND m.`retired_at` IS NULL
JOIN `brew_methods` gm ON gm.`workspace_id` = mach.`workspace_id` AND gm.`kind` = 'espresso'
SET mach.`menu_name` = gm.`name`, mach.`description` = gm.`description`, mach.`category_id` = gm.`category_id`, mach.`show_on_public_menu` = gm.`show_on_public_menu`
WHERE (SELECT COUNT(*) FROM `machines` mm WHERE mm.`workspace_id` = mach.`workspace_id` AND mm.`retired_at` IS NULL) = 1 AND (SELECT COUNT(*) FROM `brew_methods` gg WHERE gg.`workspace_id` = mach.`workspace_id` AND gg.`kind` = 'espresso') = 1;--> statement-breakpoint
UPDATE `recipes` r
JOIN `brew_methods` gm ON gm.`id` = r.`brewer_id` AND gm.`kind` = 'espresso'
JOIN `machines` m ON m.`workspace_id` = gm.`workspace_id` AND m.`retired_at` IS NULL
SET r.`brewer_id` = m.`id`
WHERE (SELECT COUNT(*) FROM `machines` mm WHERE mm.`workspace_id` = gm.`workspace_id` AND mm.`retired_at` IS NULL) = 1 AND (SELECT COUNT(*) FROM `brew_methods` gg WHERE gg.`workspace_id` = gm.`workspace_id` AND gg.`kind` = 'espresso') = 1;--> statement-breakpoint
UPDATE `drinks` d
JOIN `brew_methods` gm ON gm.`id` = d.`brewer_id` AND gm.`kind` = 'espresso'
JOIN `machines` m ON m.`workspace_id` = gm.`workspace_id` AND m.`retired_at` IS NULL
SET d.`brewer_id` = m.`id`
WHERE (SELECT COUNT(*) FROM `machines` mm WHERE mm.`workspace_id` = gm.`workspace_id` AND mm.`retired_at` IS NULL) = 1 AND (SELECT COUNT(*) FROM `brew_methods` gg WHERE gg.`workspace_id` = gm.`workspace_id` AND gg.`kind` = 'espresso') = 1;--> statement-breakpoint
UPDATE `brew_logs` l
JOIN `brew_methods` gm ON gm.`id` = l.`brewer_id` AND gm.`kind` = 'espresso'
JOIN `machines` m ON m.`workspace_id` = gm.`workspace_id` AND m.`retired_at` IS NULL
SET l.`brewer_id` = m.`id`
WHERE (SELECT COUNT(*) FROM `machines` mm WHERE mm.`workspace_id` = gm.`workspace_id` AND mm.`retired_at` IS NULL) = 1 AND (SELECT COUNT(*) FROM `brew_methods` gg WHERE gg.`workspace_id` = gm.`workspace_id` AND gg.`kind` = 'espresso') = 1;--> statement-breakpoint
DELETE FROM `brewers` WHERE `id` IN (
	SELECT gm.`id` FROM `brew_methods` gm WHERE gm.`kind` = 'espresso' AND (SELECT COUNT(*) FROM `machines` mm WHERE mm.`workspace_id` = gm.`workspace_id` AND mm.`retired_at` IS NULL) = 1 AND (SELECT COUNT(*) FROM `brew_methods` gg WHERE gg.`workspace_id` = gm.`workspace_id` AND gg.`kind` = 'espresso') = 1
);--> statement-breakpoint
ALTER TABLE `recipes` MODIFY COLUMN `brewer_id` varchar(36) NOT NULL;--> statement-breakpoint
ALTER TABLE `drinks` MODIFY COLUMN `brewer_id` varchar(36) NOT NULL;--> statement-breakpoint
ALTER TABLE `brewers` ADD CONSTRAINT `brewers_workspace_id_workspaces_id_fk` FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `brewers` ADD CONSTRAINT `brewers_category_id_drink_categories_id_fk` FOREIGN KEY (`category_id`) REFERENCES `drink_categories`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `brew_logs` ADD CONSTRAINT `brew_logs_brewer_id_brewers_id_fk` FOREIGN KEY (`brewer_id`) REFERENCES `brewers`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `drinks` ADD CONSTRAINT `drinks_brewer_id_brewers_id_fk` FOREIGN KEY (`brewer_id`) REFERENCES `brewers`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `recipes` ADD CONSTRAINT `recipes_brewer_id_brewers_id_fk` FOREIGN KEY (`brewer_id`) REFERENCES `brewers`(`id`) ON DELETE cascade ON UPDATE no action;