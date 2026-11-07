ALTER TABLE `workspaces` ADD `menu_logo_ids` json;--> statement-breakpoint
-- The one logo so far becomes the first of the list (docs/api/menu.md §7b).
UPDATE `workspaces` SET `menu_logo_ids` = JSON_ARRAY(`menu_logo_id`) WHERE `menu_logo_id` IS NOT NULL;