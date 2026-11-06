CREATE TABLE `brew_problem_brewers` (
	`brew_problem_id` varchar(36) NOT NULL,
	`brewer_id` varchar(36) NOT NULL,
	CONSTRAINT `brew_problem_brewers_brew_problem_id_brewer_id_pk` PRIMARY KEY(`brew_problem_id`,`brewer_id`)
);
--> statement-breakpoint
ALTER TABLE `brew_problems` ADD `method_kinds` json;--> statement-breakpoint
UPDATE `brew_problems` SET `method_kinds` = IF(`method_kind` IS NULL, JSON_ARRAY(), JSON_ARRAY(`method_kind`));--> statement-breakpoint
ALTER TABLE `brew_problems` MODIFY `method_kinds` json NOT NULL;--> statement-breakpoint
ALTER TABLE `brew_problem_brewers` ADD CONSTRAINT `brew_problem_brewers_brew_problem_id_brew_problems_id_fk` FOREIGN KEY (`brew_problem_id`) REFERENCES `brew_problems`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `brew_problem_brewers` ADD CONSTRAINT `brew_problem_brewers_brewer_id_brewers_id_fk` FOREIGN KEY (`brewer_id`) REFERENCES `brewers`(`id`) ON DELETE cascade ON UPDATE no action;