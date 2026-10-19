-- Expected finish becomes a window (hand-written to keep existing values).
-- An old single target becomes the window's start, with the end +15 s, the
-- same default the API applies when only one end is given.
ALTER TABLE `recipes` ADD `expected_finish_min_sec` int;
--> statement-breakpoint
ALTER TABLE `recipes` ADD `expected_finish_max_sec` int;
--> statement-breakpoint
UPDATE `recipes` SET `expected_finish_min_sec` = `expected_finish_sec`, `expected_finish_max_sec` = `expected_finish_sec` + 15 WHERE `expected_finish_sec` IS NOT NULL;
--> statement-breakpoint
ALTER TABLE `recipes` DROP COLUMN `expected_finish_sec`;
