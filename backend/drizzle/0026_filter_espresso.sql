-- Brew method is filter or espresso (docs/roadmap.md): pour over and
-- immersion behaved the same and were too narrow for drinks. How a filter
-- brewer brews moves to a descriptive style. Hand-written data steps.
ALTER TABLE `brewers` MODIFY COLUMN `kind` varchar(20) NOT NULL DEFAULT 'filter';--> statement-breakpoint
ALTER TABLE `brewers` ADD `style` varchar(20);--> statement-breakpoint
UPDATE `brewers` SET `style` = `kind` WHERE `kind` IN ('pour_over', 'immersion');--> statement-breakpoint
UPDATE `brewers` SET `kind` = 'filter' WHERE `kind` <> 'espresso';--> statement-breakpoint
UPDATE `drinks` SET `kind` = 'filter' WHERE `kind` <> 'espresso';
