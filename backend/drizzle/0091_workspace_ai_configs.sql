CREATE TABLE `workspace_ai_configs` (
	`workspace_id` varchar(36) NOT NULL,
	`provider` varchar(20) NOT NULL,
	`api_key_encrypted` text NOT NULL,
	`api_key_last4` varchar(4) NOT NULL,
	`model` varchar(100) NOT NULL,
	`vision_model` varchar(100),
	`web_model` varchar(100),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `workspace_ai_configs_workspace_id` PRIMARY KEY(`workspace_id`)
);
--> statement-breakpoint
ALTER TABLE `workspace_ai_configs` ADD CONSTRAINT `workspace_ai_configs_workspace_id_workspaces_id_fk` FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON DELETE cascade ON UPDATE no action;