CREATE TABLE `prep_tool_brewers` (
	`prep_tool_id` varchar(36) NOT NULL,
	`brewer_id` varchar(36) NOT NULL,
	CONSTRAINT `prep_tool_brewers_prep_tool_id_brewer_id_pk` PRIMARY KEY(`prep_tool_id`,`brewer_id`)
);
--> statement-breakpoint
ALTER TABLE `prep_tools` ADD `method_kinds` json;--> statement-breakpoint
UPDATE `prep_tools` SET `method_kinds` = IF(`method_kind` IS NULL, JSON_ARRAY(), JSON_ARRAY(`method_kind`));--> statement-breakpoint
ALTER TABLE `prep_tools` MODIFY `method_kinds` json NOT NULL;--> statement-breakpoint
ALTER TABLE `prep_tool_brewers` ADD CONSTRAINT `prep_tool_brewers_prep_tool_id_prep_tools_id_fk` FOREIGN KEY (`prep_tool_id`) REFERENCES `prep_tools`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `prep_tool_brewers` ADD CONSTRAINT `prep_tool_brewers_brewer_id_brewers_id_fk` FOREIGN KEY (`brewer_id`) REFERENCES `brewers`(`id`) ON DELETE cascade ON UPDATE no action;