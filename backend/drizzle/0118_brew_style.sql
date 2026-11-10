ALTER TABLE `brew_logs` ADD `style_id` varchar(36);--> statement-breakpoint
ALTER TABLE `brew_logs` ADD CONSTRAINT `brew_logs_style_id_recipe_styles_id_fk` FOREIGN KEY (`style_id`) REFERENCES `recipe_styles`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
-- Brews take their recipe's style as it is now: the best record left (docs/api/brew-logs.md §6).
UPDATE `brew_logs` bl JOIN `recipes` r ON r.`id` = bl.`recipe_id` SET bl.`style_id` = r.`style_id`;