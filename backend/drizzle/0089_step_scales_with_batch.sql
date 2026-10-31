ALTER TABLE `recipe_steps` ADD `scales_with_batch` boolean DEFAULT false NOT NULL;--> statement-breakpoint
UPDATE `recipe_steps` SET `scales_with_batch` = true WHERE `step_type` IN ('bloom', 'pour', 'wait', 'press');
