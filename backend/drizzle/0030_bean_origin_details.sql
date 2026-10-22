ALTER TABLE `beans` ADD `flavor_profile` varchar(500);--> statement-breakpoint
ALTER TABLE `beans` ADD `region` varchar(255);--> statement-breakpoint
ALTER TABLE `beans` ADD `altitude_masl` int;--> statement-breakpoint
ALTER TABLE `beans` ADD `producer` varchar(255);--> statement-breakpoint
ALTER TABLE `beans` ADD `purchase_date` date;--> statement-breakpoint
ALTER TABLE `beans` ADD `green_supplier` varchar(255);--> statement-breakpoint
ALTER TABLE `beans` ADD `rating` int;--> statement-breakpoint
-- Hand-written backfill: process was free text and is now a BEAN_PROCESSES key.
-- Matches ignore case and treat spaces and hyphens alike; anything else is cleared.
UPDATE `beans` SET `process` = CASE REPLACE(REPLACE(LOWER(TRIM(`process`)), '-', '_'), ' ', '_')
  WHEN 'washed' THEN 'washed'
  WHEN 'natural' THEN 'natural'
  WHEN 'wet_hulled' THEN 'wet_hulled'
  WHEN 'honey' THEN 'honey'
  WHEN 'mechanically_washed' THEN 'mechanically_washed'
  WHEN 'anaerobic' THEN 'anaerobic'
  WHEN 'anaerobic_fermentation' THEN 'anaerobic'
  WHEN 'carbonic_maceration' THEN 'carbonic_maceration'
  WHEN 'co_fermentation' THEN 'co_fermentation'
  WHEN 'thermal_shock' THEN 'thermal_shock'
  WHEN 'lactic' THEN 'lactic'
  WHEN 'lactic_fermentation' THEN 'lactic'
  ELSE NULL
END WHERE `process` IS NOT NULL;
