-- Drink sizes and scalable component amounts (docs/roadmap.md). Hand-written
-- data steps: a free-text amount like "40 g" or "2 pumps" becomes a value and
-- unit (oz -> fl oz); anything else ("a dusting") moves onto the note. 0018
-- drops the old amount column.
ALTER TABLE `brew_logs` ADD `serving_size` decimal(6,1);--> statement-breakpoint
ALTER TABLE `brew_logs` ADD `serving_unit` varchar(10);--> statement-breakpoint
ALTER TABLE `drink_components` ADD `amount_value` decimal(8,2);--> statement-breakpoint
ALTER TABLE `drink_components` ADD `amount_unit` varchar(20);--> statement-breakpoint
ALTER TABLE `drinks` ADD `serving_size` decimal(6,1);--> statement-breakpoint
ALTER TABLE `drinks` ADD `serving_unit` varchar(10);--> statement-breakpoint
UPDATE `drink_components`
SET `amount_value` = CAST(REGEXP_SUBSTR(TRIM(`amount`), '^[0-9]+(\\.[0-9]+)?') AS DECIMAL(8,2)),
	`amount_unit` = NULLIF(TRIM(REGEXP_REPLACE(TRIM(`amount`), '^[0-9]+(\\.[0-9]+)? *', '')), '')
WHERE TRIM(`amount`) REGEXP '^[0-9]+(\\.[0-9]+)? *[^0-9]*$';--> statement-breakpoint
UPDATE `drink_components` SET `amount_unit` = 'fl oz' WHERE LOWER(`amount_unit`) IN ('oz', 'fl oz', 'floz', 'fl. oz', 'fl.oz');--> statement-breakpoint
UPDATE `drink_components` SET `amount_unit` = LOWER(`amount_unit`) WHERE LOWER(`amount_unit`) IN ('ml', 'g');--> statement-breakpoint
UPDATE `drink_components`
SET `note` = LEFT(CONCAT(TRIM(`amount`), IF(`note` IS NULL, '', CONCAT(' · ', `note`))), 255)
WHERE `amount_value` IS NULL AND TRIM(COALESCE(`amount`, '')) <> '';
