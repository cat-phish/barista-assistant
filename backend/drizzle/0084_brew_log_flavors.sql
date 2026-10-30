CREATE TABLE `brew_log_flavors` (
	`brew_log_id` varchar(36) NOT NULL,
	`flavor_key` varchar(64) NOT NULL,
	CONSTRAINT `brew_log_flavors_brew_log_id_flavor_key_pk` PRIMARY KEY(`brew_log_id`,`flavor_key`)
);
--> statement-breakpoint
ALTER TABLE `brew_log_flavors` ADD CONSTRAINT `brew_log_flavors_brew_log_id_brew_logs_id_fk` FOREIGN KEY (`brew_log_id`) REFERENCES `brew_logs`(`id`) ON DELETE cascade ON UPDATE no action;