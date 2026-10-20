-- Drops what 0020 moved into brewers. Foreign keys first, then the columns,
-- then the tables they referenced.
ALTER TABLE `brew_logs` DROP FOREIGN KEY `brew_logs_machine_id_machines_id_fk`;--> statement-breakpoint
ALTER TABLE `drinks` DROP FOREIGN KEY `drinks_method_id_brew_methods_id_fk`;--> statement-breakpoint
ALTER TABLE `recipes` DROP FOREIGN KEY `recipes_method_id_brew_methods_id_fk`;--> statement-breakpoint
ALTER TABLE `brew_logs` DROP COLUMN `machine_id`;--> statement-breakpoint
ALTER TABLE `drinks` DROP COLUMN `method_id`;--> statement-breakpoint
ALTER TABLE `recipes` DROP COLUMN `method_id`;--> statement-breakpoint
DROP TABLE `brew_methods`;--> statement-breakpoint
DROP TABLE `machines`;
