CREATE TABLE `water_profiles` (
	`id` varchar(36) NOT NULL,
	`workspace_id` varchar(36) NOT NULL,
	`name` varchar(100) NOT NULL,
	`notes` varchar(255),
	`is_default` boolean NOT NULL DEFAULT false,
	`tds_ppm` decimal(7,2),
	`general_hardness_ppm` decimal(7,2),
	`alkalinity_ppm` decimal(7,2),
	`calcium_ppm` decimal(7,2),
	`magnesium_ppm` decimal(7,2),
	`sodium_ppm` decimal(7,2),
	`potassium_ppm` decimal(7,2),
	`bicarbonate_ppm` decimal(7,2),
	`chloride_ppm` decimal(7,2),
	`sulfate_ppm` decimal(7,2),
	`ph` decimal(3,1),
	`retired_at` timestamp,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `water_profiles_id` PRIMARY KEY(`id`),
	CONSTRAINT `water_profiles_workspace_name_unique` UNIQUE(`workspace_id`,`name`)
);
--> statement-breakpoint
ALTER TABLE `brew_logs` ADD `water_profile_id` varchar(36);--> statement-breakpoint
ALTER TABLE `water_profiles` ADD CONSTRAINT `water_profiles_workspace_id_workspaces_id_fk` FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `brew_logs` ADD CONSTRAINT `brew_logs_water_profile_id_water_profiles_id_fk` FOREIGN KEY (`water_profile_id`) REFERENCES `water_profiles`(`id`) ON DELETE set null ON UPDATE no action;