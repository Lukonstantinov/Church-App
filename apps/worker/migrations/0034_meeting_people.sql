CREATE TABLE `meeting_helpers` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`meeting_id` integer NOT NULL,
	`user_id` integer NOT NULL,
	`role` text NOT NULL,
	`notified_at` text,
	`notified_by` integer,
	`accepted_at` text,
	`declined_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`meeting_id`) REFERENCES `meetings`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `meeting_helpers_meeting` ON `meeting_helpers` (`meeting_id`);--> statement-breakpoint
ALTER TABLE `meetings` ADD `leader_declined_by` integer;--> statement-breakpoint
ALTER TABLE `meetings` ADD `snack_declined_by` integer;--> statement-breakpoint
ALTER TABLE `users` ADD `photo_media_id` integer;