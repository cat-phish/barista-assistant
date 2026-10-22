ALTER TABLE `beans` ADD `archived_at` timestamp;--> statement-breakpoint
ALTER TABLE `beans` ADD `created_at` timestamp DEFAULT (now()) NOT NULL;