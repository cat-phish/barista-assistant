CREATE TABLE `menu_items` (
	`id` varchar(36) NOT NULL,
	`section_id` varchar(36) NOT NULL,
	`position` int NOT NULL,
	`item_type` varchar(20) NOT NULL,
	`drink_id` varchar(36),
	`brewer_id` varchar(36),
	`name` varchar(255),
	`description` varchar(500),
	`price` decimal(8,2),
	`available` boolean NOT NULL DEFAULT true,
	CONSTRAINT `menu_items_id` PRIMARY KEY(`id`),
	CONSTRAINT `menu_items_section_drink_unique` UNIQUE(`section_id`,`drink_id`),
	CONSTRAINT `menu_items_section_brewer_unique` UNIQUE(`section_id`,`brewer_id`)
);
--> statement-breakpoint
CREATE TABLE `menu_sections` (
	`id` varchar(36) NOT NULL,
	`workspace_id` varchar(36) NOT NULL,
	`name` varchar(100) NOT NULL,
	`description` varchar(500),
	`position` int NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `menu_sections_id` PRIMARY KEY(`id`),
	CONSTRAINT `menu_sections_workspace_name_unique` UNIQUE(`workspace_id`,`name`)
);
--> statement-breakpoint
ALTER TABLE `workspaces` ADD `menu_currency` varchar(3);--> statement-breakpoint
ALTER TABLE `menu_items` ADD CONSTRAINT `menu_items_section_id_menu_sections_id_fk` FOREIGN KEY (`section_id`) REFERENCES `menu_sections`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `menu_items` ADD CONSTRAINT `menu_items_drink_id_drinks_id_fk` FOREIGN KEY (`drink_id`) REFERENCES `drinks`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `menu_items` ADD CONSTRAINT `menu_items_brewer_id_brewers_id_fk` FOREIGN KEY (`brewer_id`) REFERENCES `brewers`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `menu_sections` ADD CONSTRAINT `menu_sections_workspace_id_workspaces_id_fk` FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- Hand-written seed: today's automatic menu (docs/api/public-menu.md §7, before
-- the builder) becomes builder sections and items, so nothing is lost. One
-- section per category with something shown, in category order...
INSERT INTO `menu_sections` (`id`, `workspace_id`, `name`, `description`, `position`)
SELECT UUID(), c.`workspace_id`, c.`name`, NULL,
       ROW_NUMBER() OVER (PARTITION BY c.`workspace_id` ORDER BY c.`position`, c.`name`)
FROM `drink_categories` c
WHERE EXISTS (SELECT 1 FROM `brewers` b WHERE b.`category_id` = c.`id` AND b.`show_on_public_menu` = 1 AND b.`retired_at` IS NULL)
   OR EXISTS (SELECT 1 FROM `drinks` d WHERE d.`category_id` = c.`id` AND d.`show_on_public_menu` = 1);
--> statement-breakpoint
-- ...then "Other" for uncategorised items (reusing a category of that name)...
INSERT INTO `menu_sections` (`id`, `workspace_id`, `name`, `description`, `position`)
SELECT UUID(), w.`id`, 'Other', NULL,
       COALESCE((SELECT MAX(s.`position`) FROM `menu_sections` s WHERE s.`workspace_id` = w.`id`), 0) + 1
FROM `workspaces` w
WHERE NOT EXISTS (SELECT 1 FROM `menu_sections` s WHERE s.`workspace_id` = w.`id` AND s.`name` = 'Other')
  AND (EXISTS (SELECT 1 FROM `brewers` b WHERE b.`workspace_id` = w.`id` AND b.`category_id` IS NULL AND b.`show_on_public_menu` = 1 AND b.`retired_at` IS NULL)
    OR EXISTS (SELECT 1 FROM `drinks` d WHERE d.`workspace_id` = w.`id` AND d.`category_id` IS NULL AND d.`show_on_public_menu` = 1));
--> statement-breakpoint
-- ...with the shown brewers first (by menu name), then drinks (by name). A
-- brewer keeps its menu name and description as the item's.
INSERT INTO `menu_items` (`id`, `section_id`, `position`, `item_type`, `drink_id`, `brewer_id`, `name`, `description`, `price`, `available`)
SELECT UUID(), s.`id`, ROW_NUMBER() OVER (PARTITION BY s.`id` ORDER BY x.`grp`, x.`sort_name`),
       x.`item_type`, x.`drink_id`, x.`brewer_id`, x.`name`, x.`description`, NULL, 1
FROM (
  SELECT b.`workspace_id`, COALESCE(c.`name`, 'Other') AS `section_name`, 0 AS `grp`, COALESCE(b.`menu_name`, b.`name`) AS `sort_name`,
         'brewer' AS `item_type`, NULL AS `drink_id`, b.`id` AS `brewer_id`, b.`menu_name` AS `name`, b.`description` AS `description`
  FROM `brewers` b LEFT JOIN `drink_categories` c ON c.`id` = b.`category_id`
  WHERE b.`show_on_public_menu` = 1 AND b.`retired_at` IS NULL
  UNION ALL
  SELECT d.`workspace_id`, COALESCE(c.`name`, 'Other'), 1, d.`name`, 'drink', d.`id`, NULL, NULL, NULL
  FROM `drinks` d LEFT JOIN `drink_categories` c ON c.`id` = d.`category_id`
  WHERE d.`show_on_public_menu` = 1
) x
JOIN `menu_sections` s ON s.`workspace_id` = x.`workspace_id` AND s.`name` = x.`section_name`;
--> statement-breakpoint
-- Beans were listed after every section: a last "Coffee" section holds the
-- beans block, if any bean is shown (reusing a section of that name).
INSERT INTO `menu_sections` (`id`, `workspace_id`, `name`, `description`, `position`)
SELECT UUID(), w.`id`, 'Coffee', NULL,
       COALESCE((SELECT MAX(s.`position`) FROM `menu_sections` s WHERE s.`workspace_id` = w.`id`), 0) + 1
FROM `workspaces` w
WHERE NOT EXISTS (SELECT 1 FROM `menu_sections` s WHERE s.`workspace_id` = w.`id` AND s.`name` = 'Coffee')
  AND EXISTS (SELECT 1 FROM `beans` b WHERE b.`workspace_id` = w.`id` AND b.`show_on_public_menu` = 1 AND b.`archived_at` IS NULL);
--> statement-breakpoint
INSERT INTO `menu_items` (`id`, `section_id`, `position`, `item_type`, `drink_id`, `brewer_id`, `name`, `description`, `price`, `available`)
SELECT UUID(), s.`id`, COALESCE((SELECT MAX(i.`position`) FROM `menu_items` i WHERE i.`section_id` = s.`id`), 0) + 1,
       'beans', NULL, NULL, NULL, NULL, NULL, 1
FROM `menu_sections` s
WHERE s.`name` = 'Coffee'
  AND EXISTS (SELECT 1 FROM `beans` b WHERE b.`workspace_id` = s.`workspace_id` AND b.`show_on_public_menu` = 1 AND b.`archived_at` IS NULL);
