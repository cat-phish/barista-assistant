-- "Retire" is now "archive", as for beans: rename the column on brewers,
-- grinders, water profiles and prep tools. Values are kept.
ALTER TABLE `brewers` RENAME COLUMN `retired_at` TO `archived_at`;
--> statement-breakpoint
ALTER TABLE `grinders` RENAME COLUMN `retired_at` TO `archived_at`;
--> statement-breakpoint
ALTER TABLE `water_profiles` RENAME COLUMN `retired_at` TO `archived_at`;
--> statement-breakpoint
ALTER TABLE `prep_tools` RENAME COLUMN `retired_at` TO `archived_at`;
