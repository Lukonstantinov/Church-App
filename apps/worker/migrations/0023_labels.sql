CREATE TABLE `group_labels` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`group_id` integer NOT NULL,
	`name` text NOT NULL,
	`color` text NOT NULL,
	`animation` text DEFAULT 'none' NOT NULL,
	`sort` integer DEFAULT 0 NOT NULL,
	`created_by` integer,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`group_id`) REFERENCES `groups`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `group_labels_group` ON `group_labels` (`group_id`);--> statement-breakpoint
CREATE TABLE `member_labels` (
	`label_id` integer NOT NULL,
	`user_id` integer NOT NULL,
	PRIMARY KEY(`label_id`, `user_id`),
	FOREIGN KEY (`label_id`) REFERENCES `group_labels`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `member_labels_user` ON `member_labels` (`user_id`);