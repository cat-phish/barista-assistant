ALTER TABLE `beans` ADD `roast_type` varchar(20);--> statement-breakpoint
ALTER TABLE `beans` ADD `detailed_roast_level` varchar(20);--> statement-breakpoint
ALTER TABLE `beans` ADD `blend_type` varchar(20);--> statement-breakpoint
ALTER TABLE `beans` ADD `decaf` boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `beans` ADD `website` varchar(500);--> statement-breakpoint
ALTER TABLE `beans` ADD `price_amount` decimal(8,2);--> statement-breakpoint
ALTER TABLE `beans` ADD `price_currency` varchar(3);--> statement-breakpoint
ALTER TABLE `beans` ADD `bag_weight_grams` int;--> statement-breakpoint
ALTER TABLE `beans` ADD `notes` text;