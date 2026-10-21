-- Drinks get free-text instructions; brews of a drink with ingredients rate the
-- shot and the finished drink separately (docs/roadmap.md). Hand-written
-- backfill: such brews' existing rating and notes described the drink.
ALTER TABLE `brew_logs` ADD `drink_rating` int;--> statement-breakpoint
ALTER TABLE `brew_logs` ADD `drink_tasting_notes` text;--> statement-breakpoint
ALTER TABLE `drinks` ADD `instructions` text;--> statement-breakpoint
UPDATE `brew_logs` l
SET l.`drink_rating` = l.`rating`, l.`drink_tasting_notes` = l.`tasting_notes`, l.`rating` = NULL, l.`tasting_notes` = NULL
WHERE l.`drink_id` IS NOT NULL AND EXISTS (SELECT 1 FROM `drink_ingredients` di WHERE di.`drink_id` = l.`drink_id`);
