-- "Components" are now "ingredients" (docs/roadmap.md): rename the tables and
-- columns, and re-key the constraints under the names drizzle expects.
RENAME TABLE `components` TO `ingredients`, `drink_components` TO `drink_ingredients`;--> statement-breakpoint
ALTER TABLE `ingredients` RENAME COLUMN `component_type` TO `ingredient_type`;--> statement-breakpoint
ALTER TABLE `drink_ingredients` RENAME COLUMN `component_id` TO `ingredient_id`;--> statement-breakpoint
ALTER TABLE `ingredients` RENAME INDEX `components_workspace_name_unique` TO `ingredients_workspace_name_unique`;--> statement-breakpoint
ALTER TABLE `ingredients` DROP FOREIGN KEY `components_workspace_id_workspaces_id_fk`;--> statement-breakpoint
ALTER TABLE `drink_ingredients` DROP FOREIGN KEY `drink_components_drink_id_drinks_id_fk`;--> statement-breakpoint
ALTER TABLE `drink_ingredients` DROP FOREIGN KEY `drink_components_component_id_components_id_fk`;--> statement-breakpoint
ALTER TABLE `ingredients` ADD CONSTRAINT `ingredients_workspace_id_workspaces_id_fk` FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `drink_ingredients` ADD CONSTRAINT `drink_ingredients_drink_id_drinks_id_fk` FOREIGN KEY (`drink_id`) REFERENCES `drinks`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `drink_ingredients` ADD CONSTRAINT `drink_ingredients_ingredient_id_ingredients_id_fk` FOREIGN KEY (`ingredient_id`) REFERENCES `ingredients`(`id`) ON DELETE cascade ON UPDATE no action;
