CREATE TABLE `brew_log_marks` (
	`id` varchar(36) NOT NULL,
	`brew_log_id` varchar(36) NOT NULL,
	`kind` varchar(30) NOT NULL,
	`at_sec` decimal(6,1) NOT NULL,
	CONSTRAINT `brew_log_marks_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `brew_log_marks` ADD CONSTRAINT `brew_log_marks_brew_log_id_brew_logs_id_fk` FOREIGN KEY (`brew_log_id`) REFERENCES `brew_logs`(`id`) ON DELETE cascade ON UPDATE no action;