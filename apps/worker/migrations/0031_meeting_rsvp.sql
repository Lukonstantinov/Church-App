CREATE TABLE `meeting_rsvps` (
	`meeting_id` integer NOT NULL,
	`user_id` integer NOT NULL,
	`status` text NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	PRIMARY KEY(`meeting_id`, `user_id`),
	FOREIGN KEY (`meeting_id`) REFERENCES `meetings`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
ALTER TABLE `meetings` ADD `announced_by` integer;--> statement-breakpoint
ALTER TABLE `meetings` ADD `announced_at` text;--> statement-breakpoint
ALTER TABLE `meetings` ADD `ask_rsvp` integer DEFAULT false NOT NULL;