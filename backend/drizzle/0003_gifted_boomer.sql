CREATE TABLE `bean_freezes` (
	`id` varchar(36) NOT NULL,
	`bean_id` varchar(36) NOT NULL,
	`frozen_on` date NOT NULL,
	`thawed_on` date,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `bean_freezes_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `bean_freezes` ADD CONSTRAINT `bean_freezes_bean_id_beans_id_fk` FOREIGN KEY (`bean_id`) REFERENCES `beans`(`id`) ON DELETE cascade ON UPDATE no action;