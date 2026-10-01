CREATE TABLE `calendar_notes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`group_id` integer NOT NULL,
	`date` text NOT NULL,
	`text` text NOT NULL,
	`color` text NOT NULL,
	`created_by` integer,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`group_id`) REFERENCES `groups`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `calendar_notes_group_date` ON `calendar_notes` (`group_id`,`date`);--> statement-breakpoint
ALTER TABLE `events` ADD `countdown` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `meetings` ADD `leader_notified_by` integer;--> statement-breakpoint
ALTER TABLE `meetings` ADD `snack_notified_by` integer;--> statement-breakpoint
ALTER TABLE `meetings` ADD `leader_accepted_at` text;--> statement-breakpoint
ALTER TABLE `meetings` ADD `snack_accepted_at` text;