ALTER TABLE `drinks` DROP FOREIGN KEY `drinks_brewer_id_brewers_id_fk`;
--> statement-breakpoint
ALTER TABLE `drinks` DROP COLUMN `brewer_id`;