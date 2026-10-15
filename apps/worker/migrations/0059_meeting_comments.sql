CREATE TABLE `meeting_comments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`meeting_id` integer NOT NULL,
	`user_id` integer NOT NULL,
	`text` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`meeting_id`) REFERENCES `meetings`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `meeting_comments_meeting` ON `meeting_comments` (`meeting_id`,`id`);