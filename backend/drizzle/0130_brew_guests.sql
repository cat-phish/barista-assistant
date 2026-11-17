CREATE TABLE `brew_log_guests` (
	`brew_log_id` varchar(36) NOT NULL,
	`guest_id` varchar(36) NOT NULL,
	CONSTRAINT `brew_log_guests_brew_log_id_guest_id_pk` PRIMARY KEY(`brew_log_id`,`guest_id`)
);
--> statement-breakpoint
ALTER TABLE `brew_logs` ADD `for_me` boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `brew_logs` ADD `unnamed_guests` int DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `brew_log_guests` ADD CONSTRAINT `brew_log_guests_brew_log_id_brew_logs_id_fk` FOREIGN KEY (`brew_log_id`) REFERENCES `brew_logs`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `brew_log_guests` ADD CONSTRAINT `brew_log_guests_guest_id_guests_id_fk` FOREIGN KEY (`guest_id`) REFERENCES `guests`(`id`) ON DELETE cascade ON UPDATE no action;