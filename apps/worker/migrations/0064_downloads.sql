CREATE TABLE `download_parts` (
	`download_id` integer NOT NULL,
	`idx` integer NOT NULL,
	`data` blob NOT NULL,
	PRIMARY KEY(`download_id`, `idx`),
	FOREIGN KEY (`download_id`) REFERENCES `downloads`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `downloads` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`name` text NOT NULL,
	`mime` text NOT NULL,
	`bytes` integer NOT NULL,
	`parts` integer NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
