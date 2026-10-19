ALTER TABLE `recipes` DROP FOREIGN KEY `recipes_method_id_brew_methods_id_fk`;
--> statement-breakpoint
ALTER TABLE `recipes` ADD CONSTRAINT `recipes_method_id_brew_methods_id_fk` FOREIGN KEY (`method_id`) REFERENCES `brew_methods`(`id`) ON DELETE cascade ON UPDATE no action;