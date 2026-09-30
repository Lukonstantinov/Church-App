CREATE TABLE `event_photos` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`event_id` integer NOT NULL,
	`media_id` integer NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`media_id`) REFERENCES `media`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `event_photos_event` ON `event_photos` (`event_id`);--> statement-breakpoint
CREATE TABLE `event_role_assignees` (
	`role_id` integer NOT NULL,
	`user_id` integer NOT NULL,
	PRIMARY KEY(`role_id`, `user_id`),
	FOREIGN KEY (`role_id`) REFERENCES `event_roles`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `event_role_assignees_user` ON `event_role_assignees` (`user_id`);--> statement-breakpoint
CREATE TABLE `event_roles` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`event_id` integer NOT NULL,
	`name` text NOT NULL,
	`slots` integer DEFAULT 1 NOT NULL,
	`sort` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `event_roles_event` ON `event_roles` (`event_id`);--> statement-breakpoint
CREATE TABLE `event_rsvps` (
	`event_id` integer NOT NULL,
	`user_id` integer NOT NULL,
	`status` text NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	PRIMARY KEY(`event_id`, `user_id`),
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "event_rsvps_status" CHECK("event_rsvps"."status" IN ('going', 'not_going'))
);
--> statement-breakpoint
CREATE TABLE `events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`group_id` integer NOT NULL,
	`title` text NOT NULL,
	`description` text,
	`starts_at` text NOT NULL,
	`ends_at` text,
	`location` text,
	`cover_media_id` integer,
	`has_gallery` integer DEFAULT false NOT NULL,
	`has_rsvp` integer DEFAULT false NOT NULL,
	`has_duties` integer DEFAULT false NOT NULL,
	`has_cost` integer DEFAULT false NOT NULL,
	`price_cents` integer,
	`chat_url` text,
	`status` text DEFAULT 'scheduled' NOT NULL,
	`created_by` integer,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`group_id`) REFERENCES `groups`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`cover_media_id`) REFERENCES `media`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "events_status" CHECK("events"."status" IN ('scheduled', 'cancelled'))
);
--> statement-breakpoint
CREATE INDEX `events_group_starts` ON `events` (`group_id`,`starts_at`);--> statement-breakpoint
ALTER TABLE `groups` ADD `chat_url` text;