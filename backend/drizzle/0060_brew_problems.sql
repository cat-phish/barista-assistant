CREATE TABLE `brew_log_problems` (
	`brew_log_id` varchar(36) NOT NULL,
	`problem_id` varchar(36) NOT NULL,
	CONSTRAINT `brew_log_problems_brew_log_id_problem_id_pk` PRIMARY KEY(`brew_log_id`,`problem_id`)
);
--> statement-breakpoint
CREATE TABLE `brew_problems` (
	`id` varchar(36) NOT NULL,
	`workspace_id` varchar(36) NOT NULL,
	`name` varchar(100) NOT NULL,
	`method_kind` varchar(20),
	`position` int NOT NULL,
	`archived_at` timestamp,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `brew_problems_id` PRIMARY KEY(`id`),
	CONSTRAINT `brew_problems_workspace_name_unique` UNIQUE(`workspace_id`,`name`)
);
--> statement-breakpoint
ALTER TABLE `brew_log_problems` ADD CONSTRAINT `brew_log_problems_brew_log_id_brew_logs_id_fk` FOREIGN KEY (`brew_log_id`) REFERENCES `brew_logs`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `brew_log_problems` ADD CONSTRAINT `brew_log_problems_problem_id_brew_problems_id_fk` FOREIGN KEY (`problem_id`) REFERENCES `brew_problems`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `brew_problems` ADD CONSTRAINT `brew_problems_workspace_id_workspaces_id_fk` FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
INSERT INTO `brew_problems` (`id`, `workspace_id`, `name`, `method_kind`, `position`)
SELECT UUID(), w.`id`, t.`name`, t.`method_kind`, t.`position` FROM `workspaces` w
CROSS JOIN (
  SELECT 'Slow drawdown / stalled bed' AS `name`, 'filter' AS `method_kind`, 1 AS `position`
  UNION ALL
  SELECT 'Fast drawdown' AS `name`, 'filter' AS `method_kind`, 2 AS `position`
  UNION ALL
  SELECT 'Uneven or cratered bed' AS `name`, 'filter' AS `method_kind`, 3 AS `position`
  UNION ALL
  SELECT 'Grounds high on the walls' AS `name`, 'filter' AS `method_kind`, 4 AS `position`
  UNION ALL
  SELECT 'Channeling (holes in the bed)' AS `name`, 'filter' AS `method_kind`, 5 AS `position`
  UNION ALL
  SELECT 'Filter clogged or collapsed' AS `name`, 'filter' AS `method_kind`, 6 AS `position`
  UNION ALL
  SELECT 'Poured too fast or uneven' AS `name`, 'filter' AS `method_kind`, 7 AS `position`
  UNION ALL
  SELECT 'Missed a pour target' AS `name`, 'filter' AS `method_kind`, 8 AS `position`
  UNION ALL
  SELECT 'Water too hot or cold (kettle off)' AS `name`, 'filter' AS `method_kind`, 9 AS `position`
  UNION ALL
  SELECT 'Immersion: grounds didn''t sink, crust didn''t break' AS `name`, 'filter' AS `method_kind`, 10 AS `position`
  UNION ALL
  SELECT 'Channeling / spurting' AS `name`, 'espresso' AS `method_kind`, 11 AS `position`
  UNION ALL
  SELECT 'Shot ran fast (gushed)' AS `name`, 'espresso' AS `method_kind`, 12 AS `position`
  UNION ALL
  SELECT 'Shot choked or dripped slowly' AS `name`, 'espresso' AS `method_kind`, 13 AS `position`
  UNION ALL
  SELECT 'Uneven extraction (one spout first, blonding early)' AS `name`, 'espresso' AS `method_kind`, 14 AS `position`
  UNION ALL
  SELECT 'Puck wet or soupy' AS `name`, 'espresso' AS `method_kind`, 15 AS `position`
  UNION ALL
  SELECT 'Puck cracked or stuck to the screen' AS `name`, 'espresso' AS `method_kind`, 16 AS `position`
  UNION ALL
  SELECT 'Grinder clumping' AS `name`, 'espresso' AS `method_kind`, 17 AS `position`
  UNION ALL
  SELECT 'Dose spilled or uneven tamp' AS `name`, 'espresso' AS `method_kind`, 18 AS `position`
  UNION ALL
  SELECT 'Machine temperature not settled' AS `name`, 'espresso' AS `method_kind`, 19 AS `position`
  UNION ALL
  SELECT 'Stale or old beans' AS `name`, NULL AS `method_kind`, 20 AS `position`
  UNION ALL
  SELECT 'Grind setting changed by mistake' AS `name`, NULL AS `method_kind`, 21 AS `position`
  UNION ALL
  SELECT 'Scale not tared' AS `name`, NULL AS `method_kind`, 22 AS `position`
  UNION ALL
  SELECT 'Distracted / timer missed' AS `name`, NULL AS `method_kind`, 23 AS `position`
) t;
