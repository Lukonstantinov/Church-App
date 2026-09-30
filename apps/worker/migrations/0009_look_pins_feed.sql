CREATE TABLE `announcement_comments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`announcement_id` integer NOT NULL,
	`user_id` integer NOT NULL,
	`text` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`announcement_id`) REFERENCES `announcements`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `announcement_comments_post` ON `announcement_comments` (`announcement_id`,`id`);--> statement-breakpoint
CREATE TABLE `announcement_reactions` (
	`announcement_id` integer NOT NULL,
	`user_id` integer NOT NULL,
	`emoji` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	PRIMARY KEY(`announcement_id`, `user_id`, `emoji`),
	FOREIGN KEY (`announcement_id`) REFERENCES `announcements`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `design_templates` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`brand_color` text,
	`pattern` text,
	`text_color` text DEFAULT 'auto' NOT NULL,
	`logo_media_id` integer,
	`created_by` integer,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `feed_reads` (
	`user_id` integer NOT NULL,
	`group_id` integer NOT NULL,
	`last_post_id` integer DEFAULT 0 NOT NULL,
	`last_comment_id` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`user_id`, `group_id`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`group_id`) REFERENCES `groups`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
ALTER TABLE `announcements` ADD `title` text;--> statement-breakpoint
ALTER TABLE `announcements` ADD `media_ids` text;--> statement-breakpoint
ALTER TABLE `announcements` ADD `tint_color` text;--> statement-breakpoint
ALTER TABLE `announcements` ADD `tint_strength` real;--> statement-breakpoint
ALTER TABLE `announcements` ADD `template_id` integer;--> statement-breakpoint
ALTER TABLE `announcements` ADD `deleted_at` text;--> statement-breakpoint
ALTER TABLE `events` ADD `pinned_at` text;--> statement-breakpoint
ALTER TABLE `groups` ADD `text_color` text DEFAULT 'auto' NOT NULL;--> statement-breakpoint
ALTER TABLE `groups` ADD `animation` text DEFAULT 'rise' NOT NULL;--> statement-breakpoint
ALTER TABLE `groups` ADD `badge_color` text;--> statement-breakpoint
ALTER TABLE `users` ADD `last_seen_at` text;