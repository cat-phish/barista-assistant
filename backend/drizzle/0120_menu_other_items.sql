CREATE TABLE `menu_other_items` (
	`id` varchar(36) NOT NULL,
	`workspace_id` varchar(36) NOT NULL,
	`name` varchar(100) NOT NULL,
	`description` varchar(500),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `menu_other_items_id` PRIMARY KEY(`id`),
	CONSTRAINT `menu_other_items_workspace_name_unique` UNIQUE(`workspace_id`,`name`)
);
--> statement-breakpoint
ALTER TABLE `menu_items` ADD `other_item_id` varchar(36);--> statement-breakpoint
ALTER TABLE `menu_items` ADD CONSTRAINT `menu_items_section_other_unique` UNIQUE(`section_id`,`other_item_id`);--> statement-breakpoint
ALTER TABLE `menu_other_items` ADD CONSTRAINT `menu_other_items_workspace_id_workspaces_id_fk` FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `menu_items` ADD CONSTRAINT `menu_items_other_item_id_menu_other_items_id_fk` FOREIGN KEY (`other_item_id`) REFERENCES `menu_other_items`(`id`) ON DELETE cascade ON UPDATE no action;