ALTER TABLE `brewers` DROP FOREIGN KEY `brewers_category_id_drink_categories_id_fk`;
--> statement-breakpoint
ALTER TABLE `brewers` DROP COLUMN `menu_name`;--> statement-breakpoint
ALTER TABLE `brewers` DROP COLUMN `description`;--> statement-breakpoint
ALTER TABLE `brewers` DROP COLUMN `category_id`;--> statement-breakpoint
ALTER TABLE `brewers` DROP COLUMN `show_on_public_menu`;--> statement-breakpoint
ALTER TABLE `drinks` DROP COLUMN `show_on_public_menu`;--> statement-breakpoint
-- Hand-written cleanup: categories are for drinks only now, so ones no drink
-- uses (they grouped brewers, e.g. "Filter", "Espresso") are removed...
DELETE FROM `drink_categories`
WHERE `id` NOT IN (SELECT `category_id` FROM `drinks` WHERE `category_id` IS NOT NULL);
--> statement-breakpoint
-- ...and the rest renumbered 1, 2, 3... in their order, per workspace.
UPDATE `drink_categories` c
JOIN (
  SELECT `id`, ROW_NUMBER() OVER (PARTITION BY `workspace_id` ORDER BY `position`, `name`) AS `pos`
  FROM `drink_categories`
) r ON r.`id` = c.`id`
SET c.`position` = r.`pos`;
