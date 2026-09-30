CREATE TABLE `post_reads` (
	`user_id` integer NOT NULL,
	`announcement_id` integer NOT NULL,
	`last_comment_id` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`user_id`, `announcement_id`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`announcement_id`) REFERENCES `announcements`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
ALTER TABLE `announcements` ADD `pinned_at` text;--> statement-breakpoint
ALTER TABLE `design_templates` ADD `backdrop` text;--> statement-breakpoint
ALTER TABLE `groups` ADD `backdrop` text;