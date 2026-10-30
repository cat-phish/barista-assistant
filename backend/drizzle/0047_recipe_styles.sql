CREATE TABLE `recipe_styles` (
	`id` varchar(36) NOT NULL,
	`workspace_id` varchar(36) NOT NULL,
	`kind` varchar(20) NOT NULL,
	`name` varchar(100) NOT NULL,
	`position` int NOT NULL,
	`hidden` boolean NOT NULL DEFAULT false,
	`builtin` varchar(20),
	`brews_like` varchar(20) NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `recipe_styles_id` PRIMARY KEY(`id`),
	CONSTRAINT `recipe_styles_workspace_kind_name` UNIQUE(`workspace_id`,`kind`,`name`)
);
--> statement-breakpoint
ALTER TABLE `recipes` ADD `style_id` varchar(36);--> statement-breakpoint
ALTER TABLE `recipe_styles` ADD CONSTRAINT `recipe_styles_workspace_id_workspaces_id_fk` FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `recipes` ADD CONSTRAINT `recipes_style_id_recipe_styles_id_fk` FOREIGN KEY (`style_id`) REFERENCES `recipe_styles`(`id`) ON DELETE set null ON UPDATE no action;