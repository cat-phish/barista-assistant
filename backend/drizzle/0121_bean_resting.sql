ALTER TABLE `beans` ADD `resting_until` date;--> statement-breakpoint
ALTER TABLE `beans` ADD `rest_in_brew_picker` boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `beans` ADD `resting_by` varchar(36);--> statement-breakpoint
ALTER TABLE `beans` ADD `rest_last_reminded_on` date;--> statement-breakpoint
ALTER TABLE `beans` ADD CONSTRAINT `beans_resting_by_users_id_fk` FOREIGN KEY (`resting_by`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
-- Resting moves from roasts to beans (docs/api/beans.md §4): a roast still
-- resting (ready today or later, its local day) puts its bean in Resting,
-- brewable as before. A ready-morning reminder already sent today counts.
UPDATE `beans` b JOIN `roasts` r ON r.`bean_id` = b.`id`
SET b.`resting_until` = DATE(r.`roasted_at` + INTERVAL COALESCE(r.`utc_offset_minutes`, 0) MINUTE) + INTERVAL r.`rest_days` DAY,
    b.`rest_in_brew_picker` = true,
    b.`resting_by` = r.`user_id`,
    b.`rest_last_reminded_on` = CASE
      WHEN DATE(r.`roasted_at` + INTERVAL COALESCE(r.`utc_offset_minutes`, 0) MINUTE) + INTERVAL r.`rest_days` DAY = DATE(UTC_TIMESTAMP() + INTERVAL COALESCE(r.`utc_offset_minutes`, 0) MINUTE)
        AND HOUR(UTC_TIMESTAMP() + INTERVAL COALESCE(r.`utc_offset_minutes`, 0) MINUTE) >= 8
      THEN DATE(UTC_TIMESTAMP() + INTERVAL COALESCE(r.`utc_offset_minutes`, 0) MINUTE)
      ELSE NULL END
WHERE b.`archived_at` IS NULL AND r.`rest_days` > 0
  AND NOT EXISTS (SELECT 1 FROM `bean_freezes` f WHERE f.`bean_id` = b.`id` AND f.`thawed_on` IS NULL)
  AND DATE(r.`roasted_at` + INTERVAL COALESCE(r.`utc_offset_minutes`, 0) MINUTE) + INTERVAL r.`rest_days` DAY >= DATE(UTC_TIMESTAMP() + INTERVAL COALESCE(r.`utc_offset_minutes`, 0) MINUTE);--> statement-breakpoint
ALTER TABLE `roasts` DROP COLUMN `rest_days`;