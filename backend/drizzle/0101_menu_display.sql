ALTER TABLE `menu_items` ADD `bean_batches` varchar(10);--> statement-breakpoint
ALTER TABLE `menu_items` ADD `show_method` boolean;--> statement-breakpoint
ALTER TABLE `menu_items` ADD `show_ingredients` boolean;--> statement-breakpoint
ALTER TABLE `workspaces` ADD `menu_show_method` boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `workspaces` ADD `menu_show_ingredients` boolean DEFAULT false NOT NULL;