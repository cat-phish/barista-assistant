ALTER TABLE `users` ADD `song_mime` varchar(32);--> statement-breakpoint
ALTER TABLE `users` ADD `song_bytes` int;--> statement-breakpoint
ALTER TABLE `users` ADD `song_name` varchar(100);--> statement-breakpoint
ALTER TABLE `users` ADD `song_uploaded_at` timestamp;