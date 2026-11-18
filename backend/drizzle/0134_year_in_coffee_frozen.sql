ALTER TABLE `recaps` MODIFY COLUMN `kind` varchar(16) NOT NULL;--> statement-breakpoint
ALTER TABLE `recaps` ADD `figures` json;