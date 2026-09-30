CREATE TABLE `announcements` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`group_id` integer NOT NULL,
	`author_id` integer,
	`text` text NOT NULL,
	`recipients` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`group_id`) REFERENCES `groups`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`author_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `announcements_group_created` ON `announcements` (`group_id`,`created_at`);--> statement-breakpoint
ALTER TABLE `church_settings` ADD `default_locale` text DEFAULT 'ru' NOT NULL;--> statement-breakpoint
ALTER TABLE `church_settings` ADD `brand_color` text DEFAULT 'blue' NOT NULL;--> statement-breakpoint
ALTER TABLE `church_settings` ADD `logo_data` text;--> statement-breakpoint
ALTER TABLE `church_settings` ADD `logo_mime` text;--> statement-breakpoint
ALTER TABLE `church_settings` ADD `logo_updated_at` text;--> statement-breakpoint
ALTER TABLE `users` ADD `locale` text;