-- Style moves from brewers to recipes (docs/roadmap.md): one brewer brews in
-- several ways (an AeroPress inverted or bypass, a soup shot on the same
-- machine). Hand-written data steps: each recipe takes its brewer's style;
-- espresso recipes, which had none, become standard shots. 0028 drops
-- brewers.style.
ALTER TABLE `recipes` ADD `style` varchar(20);--> statement-breakpoint
UPDATE `recipes` r JOIN `brewers` b ON b.`id` = r.`brewer_id` SET r.`style` = b.`style` WHERE b.`kind` = 'filter';--> statement-breakpoint
UPDATE `recipes` r JOIN `brewers` b ON b.`id` = r.`brewer_id` SET r.`style` = 'standard' WHERE b.`kind` = 'espresso';
