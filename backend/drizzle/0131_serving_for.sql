ALTER TABLE `brew_servings` ADD `for_guest` boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `brew_servings` ADD `guest_id` varchar(36);--> statement-breakpoint
ALTER TABLE `brew_servings` ADD CONSTRAINT `brew_servings_guest_id_guests_id_fk` FOREIGN KEY (`guest_id`) REFERENCES `guests`(`id`) ON DELETE set null ON UPDATE no action;