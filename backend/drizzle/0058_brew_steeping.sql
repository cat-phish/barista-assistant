ALTER TABLE `brew_logs` ADD `steeping` boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `brew_logs` ADD `steep_temp` varchar(10);--> statement-breakpoint
ALTER TABLE `brew_logs` ADD `dilution_ratio` decimal(3,1);--> statement-breakpoint
ALTER TABLE `brew_logs` ADD `diluted_with` varchar(10);