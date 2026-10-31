ALTER TABLE `brew_logs` ADD `step_temp_shift_c` decimal(4,1);--> statement-breakpoint
ALTER TABLE `recipes` ADD `step_temps_follow_brew` boolean DEFAULT false NOT NULL;