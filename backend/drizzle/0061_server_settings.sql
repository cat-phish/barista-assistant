CREATE TABLE `server_settings` (
	`key` varchar(50) NOT NULL,
	`value` json,
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `server_settings_key` PRIMARY KEY(`key`)
);
