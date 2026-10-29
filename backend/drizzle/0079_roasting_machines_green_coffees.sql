CREATE TABLE `green_coffees` (
	`id` varchar(36) NOT NULL,
	`workspace_id` varchar(36) NOT NULL,
	`name` varchar(255) NOT NULL,
	`origin_area` varchar(20),
	`country` varchar(100),
	`region` varchar(255),
	`producer` varchar(255),
	`altitude_masl` int,
	`varieties` json,
	`species` json,
	`process_id` varchar(36),
	`supplier` varchar(255),
	`lot` varchar(100),
	`price_amount` decimal(8,2),
	`price_currency` varchar(3),
	`weight_bought_grams` int,
	`weight_left_grams` int NOT NULL DEFAULT 0,
	`low_stock_grams` int,
	`purchase_date` date,
	`notes` text,
	`archived_at` timestamp,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `green_coffees_id` PRIMARY KEY(`id`),
	CONSTRAINT `green_coffees_workspace_name_unique` UNIQUE(`workspace_id`,`name`)
);
--> statement-breakpoint
CREATE TABLE `roasting_machines` (
	`id` varchar(36) NOT NULL,
	`workspace_id` varchar(36) NOT NULL,
	`name` varchar(100) NOT NULL,
	`notes` varchar(255),
	`capacity_grams` int,
	`archived_at` timestamp,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `roasting_machines_id` PRIMARY KEY(`id`),
	CONSTRAINT `roasting_machines_workspace_name_unique` UNIQUE(`workspace_id`,`name`)
);
--> statement-breakpoint
ALTER TABLE `green_coffees` ADD CONSTRAINT `green_coffees_workspace_id_workspaces_id_fk` FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `green_coffees` ADD CONSTRAINT `green_coffees_process_id_bean_processes_id_fk` FOREIGN KEY (`process_id`) REFERENCES `bean_processes`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `roasting_machines` ADD CONSTRAINT `roasting_machines_workspace_id_workspaces_id_fk` FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON DELETE cascade ON UPDATE no action;