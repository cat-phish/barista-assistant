-- Drinks are built on one brew method (any of its recipes can make them),
-- can be variants of other drinks, and use a managed category list
-- (docs/roadmap.md). Hand-written data steps: categories come from the old
-- free-text values; a drink's method comes from its default recipe (else one
-- of its recipes, else the workspace's first method); plain drinks (no
-- components, named like their method) move their menu settings onto the
-- method and are removed. 0016 drops drink_recipes and drinks.category.
CREATE TABLE `drink_categories` (
	`id` varchar(36) NOT NULL,
	`workspace_id` varchar(36) NOT NULL,
	`name` varchar(100) NOT NULL,
	`position` int NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `drink_categories_id` PRIMARY KEY(`id`),
	CONSTRAINT `drink_categories_workspace_name_unique` UNIQUE(`workspace_id`,`name`)
);
--> statement-breakpoint
ALTER TABLE `brew_methods` ADD `description` varchar(500);--> statement-breakpoint
ALTER TABLE `brew_methods` ADD `category_id` varchar(36);--> statement-breakpoint
ALTER TABLE `brew_methods` ADD `show_on_public_menu` boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `drinks` ADD `method_id` varchar(36);--> statement-breakpoint
ALTER TABLE `drinks` ADD `category_id` varchar(36);--> statement-breakpoint
ALTER TABLE `drinks` ADD `parent_drink_id` varchar(36);--> statement-breakpoint
INSERT INTO `drink_categories` (`id`, `workspace_id`, `name`, `position`)
SELECT UUID(), `workspace_id`, `category`, ROW_NUMBER() OVER (PARTITION BY `workspace_id` ORDER BY `category`)
FROM (SELECT DISTINCT `workspace_id`, `category` FROM `drinks` WHERE `category` IS NOT NULL) AS c;--> statement-breakpoint
UPDATE `drinks` d JOIN `drink_categories` c ON c.`workspace_id` = d.`workspace_id` AND c.`name` = d.`category` SET d.`category_id` = c.`id`;--> statement-breakpoint
UPDATE `drinks` d JOIN `recipes` r ON r.`id` = d.`default_recipe_id` SET d.`method_id` = r.`method_id`;--> statement-breakpoint
UPDATE `drinks` d SET d.`method_id` = (
	SELECT r.`method_id` FROM `drink_recipes` dr JOIN `recipes` r ON r.`id` = dr.`recipe_id` WHERE dr.`drink_id` = d.`id` ORDER BY r.`name` LIMIT 1
) WHERE d.`method_id` IS NULL;--> statement-breakpoint
UPDATE `drinks` d SET d.`method_id` = (
	SELECT m.`id` FROM `brew_methods` m WHERE m.`workspace_id` = d.`workspace_id` ORDER BY m.`name` LIMIT 1
) WHERE d.`method_id` IS NULL;--> statement-breakpoint
DELETE FROM `drinks` WHERE `method_id` IS NULL;--> statement-breakpoint
UPDATE `brew_methods` m JOIN `drinks` d ON d.`method_id` = m.`id` AND d.`name` = m.`name`
SET m.`show_on_public_menu` = d.`show_on_public_menu`, m.`description` = d.`description`, m.`category_id` = d.`category_id`
WHERE NOT EXISTS (SELECT 1 FROM `drink_components` dc WHERE dc.`drink_id` = d.`id`);--> statement-breakpoint
DELETE FROM `drinks`
WHERE NOT EXISTS (SELECT 1 FROM `drink_components` dc WHERE dc.`drink_id` = `drinks`.`id`)
AND EXISTS (SELECT 1 FROM `brew_methods` m WHERE m.`id` = `drinks`.`method_id` AND m.`name` = `drinks`.`name`);--> statement-breakpoint
ALTER TABLE `drinks` MODIFY COLUMN `method_id` varchar(36) NOT NULL;--> statement-breakpoint
ALTER TABLE `drink_categories` ADD CONSTRAINT `drink_categories_workspace_id_workspaces_id_fk` FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `brew_methods` ADD CONSTRAINT `brew_methods_category_id_drink_categories_id_fk` FOREIGN KEY (`category_id`) REFERENCES `drink_categories`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `drinks` ADD CONSTRAINT `drinks_method_id_brew_methods_id_fk` FOREIGN KEY (`method_id`) REFERENCES `brew_methods`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `drinks` ADD CONSTRAINT `drinks_category_id_drink_categories_id_fk` FOREIGN KEY (`category_id`) REFERENCES `drink_categories`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `drinks` ADD CONSTRAINT `drinks_parent_drink_id_drinks_id_fk` FOREIGN KEY (`parent_drink_id`) REFERENCES `drinks`(`id`) ON DELETE set null ON UPDATE no action;