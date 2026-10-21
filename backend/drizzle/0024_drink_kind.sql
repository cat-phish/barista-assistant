-- A drink needs a kind of coffee, not one device: any brewer of that kind can
-- make it (docs/roadmap.md). Hand-written backfill: the kind of the brewer it
-- was built on. 0025 drops drinks.brewer_id.
ALTER TABLE `drinks` ADD `kind` varchar(20);--> statement-breakpoint
UPDATE `drinks` d JOIN `brewers` b ON b.`id` = d.`brewer_id` SET d.`kind` = b.`kind`;--> statement-breakpoint
UPDATE `drinks` SET `kind` = 'pour_over' WHERE `kind` IS NULL;--> statement-breakpoint
ALTER TABLE `drinks` MODIFY COLUMN `kind` varchar(20) NOT NULL;
