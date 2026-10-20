-- Phase 2a (docs/roadmap.md): method kinds, espresso recipes and logs.
-- Existing methods get their kind by name (the collation is case-insensitive);
-- everything else stays pour_over. Existing espresso recipes keep their
-- water value until they're next edited (the form then asks for a target yield).
ALTER TABLE `brew_logs` MODIFY COLUMN `actual_water_grams` decimal(6,2);--> statement-breakpoint
ALTER TABLE `recipes` MODIFY COLUMN `target_water_grams` decimal(6,2);--> statement-breakpoint
ALTER TABLE `brew_methods` ADD `kind` varchar(20) DEFAULT 'pour_over' NOT NULL;--> statement-breakpoint
ALTER TABLE `recipes` ADD `first_drop_min_sec` int;--> statement-breakpoint
ALTER TABLE `recipes` ADD `first_drop_max_sec` int;
--> statement-breakpoint
UPDATE `brew_methods` SET `kind` = 'espresso' WHERE `name` IN ('Espresso', 'Latte');
--> statement-breakpoint
UPDATE `brew_methods` SET `kind` = 'immersion' WHERE `name` IN ('Aeropress', 'AeroPress', 'French press', 'French Press');
