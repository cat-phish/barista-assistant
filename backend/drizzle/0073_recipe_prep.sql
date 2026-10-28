CREATE TABLE `recipe_prep_tools` (
	`recipe_id` varchar(36) NOT NULL,
	`tool_id` varchar(36) NOT NULL,
	CONSTRAINT `recipe_prep_tools_recipe_id_tool_id_pk` PRIMARY KEY(`recipe_id`,`tool_id`)
);
--> statement-breakpoint
ALTER TABLE `recipe_prep_tools` ADD CONSTRAINT `recipe_prep_tools_recipe_id_recipes_id_fk` FOREIGN KEY (`recipe_id`) REFERENCES `recipes`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `recipe_prep_tools` ADD CONSTRAINT `recipe_prep_tools_tool_id_prep_tools_id_fk` FOREIGN KEY (`tool_id`) REFERENCES `prep_tools`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- A repeat always copies the prep now (docs/api/auth.md §1 repeatKeeps): drop it from saved choices.
UPDATE `users` SET `preferences` = JSON_REMOVE(`preferences`, JSON_UNQUOTE(JSON_SEARCH(`preferences`, 'one', 'prepTools', NULL, '$.repeatKeeps'))) WHERE JSON_SEARCH(`preferences`, 'one', 'prepTools', NULL, '$.repeatKeeps') IS NOT NULL;