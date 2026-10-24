ALTER TABLE `llm_analyses` ADD `next_step` varchar(200);--> statement-breakpoint
ALTER TABLE `llm_analyses` ADD `confidence` varchar(10);--> statement-breakpoint
ALTER TABLE `llm_analyses` ADD `suggested_rpm_delta` int;--> statement-breakpoint
ALTER TABLE `llm_analyses` ADD `model` varchar(100);--> statement-breakpoint
ALTER TABLE `llm_analyses` ADD `prompt_version` varchar(30);--> statement-breakpoint
ALTER TABLE `llm_analyses` ADD `helpful` boolean;--> statement-breakpoint
ALTER TABLE `llm_analyses` ADD `rated_at` timestamp;