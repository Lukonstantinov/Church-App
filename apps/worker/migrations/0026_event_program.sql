CREATE TABLE `event_program` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`event_id` integer NOT NULL,
	`day` integer DEFAULT 0 NOT NULL,
	`time` text NOT NULL,
	`title` text NOT NULL,
	`user_id` integer,
	`note` text,
	`sort` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `event_program_event` ON `event_program` (`event_id`);