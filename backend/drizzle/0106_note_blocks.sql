ALTER TABLE `notes` ADD `blocks` json;--> statement-breakpoint
UPDATE `notes` SET `blocks` = IF(`body` = '', JSON_ARRAY(), JSON_ARRAY(JSON_OBJECT('id', UUID(), 'type', 'text', 'text', `body`)));--> statement-breakpoint
ALTER TABLE `notes` MODIFY `blocks` json NOT NULL;
