CREATE TABLE `event_messages` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`event_id` integer NOT NULL,
	`user_id` integer NOT NULL,
	`text` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `event_messages_event` ON `event_messages` (`event_id`,`id`);--> statement-breakpoint
ALTER TABLE `event_roles` ADD `description` text;--> statement-breakpoint
ALTER TABLE `events` ADD `tg_chat_id` integer;--> statement-breakpoint
ALTER TABLE `events` ADD `tg_chat_title` text;--> statement-breakpoint
ALTER TABLE `events` ADD `chat_link_code` text;