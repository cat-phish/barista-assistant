-- Phase 3 (docs/roadmap.md): drinks and components. Hand-written data steps
-- below: each recipe that was on the public menu becomes a plain drink of the
-- same name (it moves the menu flag from recipes to drinks), and the old
-- "Latte" method goes wherever no recipe uses it (latte is now a drink).
CREATE TABLE `components` (
	`id` varchar(36) NOT NULL,
	`workspace_id` varchar(36) NOT NULL,
	`name` varchar(100) NOT NULL,
	`component_type` varchar(20) NOT NULL DEFAULT 'other',
	`instructions` text,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `components_id` PRIMARY KEY(`id`),
	CONSTRAINT `components_workspace_name_unique` UNIQUE(`workspace_id`,`name`)
);
--> statement-breakpoint
CREATE TABLE `drink_components` (
	`id` varchar(36) NOT NULL,
	`drink_id` varchar(36) NOT NULL,
	`component_id` varchar(36) NOT NULL,
	`position` int NOT NULL,
	`amount` varchar(50),
	`note` varchar(255),
	CONSTRAINT `drink_components_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `drink_recipes` (
	`drink_id` varchar(36) NOT NULL,
	`recipe_id` varchar(36) NOT NULL,
	CONSTRAINT `drink_recipes_drink_id_recipe_id_pk` PRIMARY KEY(`drink_id`,`recipe_id`)
);
--> statement-breakpoint
CREATE TABLE `drinks` (
	`id` varchar(36) NOT NULL,
	`workspace_id` varchar(36) NOT NULL,
	`name` varchar(255) NOT NULL,
	`description` varchar(500),
	`default_recipe_id` varchar(36),
	`show_on_public_menu` boolean NOT NULL DEFAULT true,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `drinks_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `brew_logs` ADD `drink_id` varchar(36);--> statement-breakpoint
ALTER TABLE `components` ADD CONSTRAINT `components_workspace_id_workspaces_id_fk` FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `drink_components` ADD CONSTRAINT `drink_components_drink_id_drinks_id_fk` FOREIGN KEY (`drink_id`) REFERENCES `drinks`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `drink_components` ADD CONSTRAINT `drink_components_component_id_components_id_fk` FOREIGN KEY (`component_id`) REFERENCES `components`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `drink_recipes` ADD CONSTRAINT `drink_recipes_drink_id_drinks_id_fk` FOREIGN KEY (`drink_id`) REFERENCES `drinks`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `drink_recipes` ADD CONSTRAINT `drink_recipes_recipe_id_recipes_id_fk` FOREIGN KEY (`recipe_id`) REFERENCES `recipes`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `drinks` ADD CONSTRAINT `drinks_workspace_id_workspaces_id_fk` FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `drinks` ADD CONSTRAINT `drinks_default_recipe_id_recipes_id_fk` FOREIGN KEY (`default_recipe_id`) REFERENCES `recipes`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `brew_logs` ADD CONSTRAINT `brew_logs_drink_id_drinks_id_fk` FOREIGN KEY (`drink_id`) REFERENCES `drinks`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
INSERT INTO `drinks` (`id`, `workspace_id`, `name`, `default_recipe_id`, `show_on_public_menu`)
SELECT UUID(), `workspace_id`, `name`, `id`, true FROM `recipes` WHERE `show_on_public_menu` = true;--> statement-breakpoint
INSERT INTO `drink_recipes` (`drink_id`, `recipe_id`) SELECT `id`, `default_recipe_id` FROM `drinks`;--> statement-breakpoint
DELETE FROM `brew_methods` WHERE `name` = 'Latte' AND NOT EXISTS (SELECT 1 FROM `recipes` r WHERE r.`method_id` = `brew_methods`.`id`);--> statement-breakpoint
ALTER TABLE `recipes` DROP COLUMN `show_on_public_menu`;