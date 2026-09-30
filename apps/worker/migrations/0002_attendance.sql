CREATE TABLE `attendance` (
	`meeting_id` integer NOT NULL,
	`user_id` integer NOT NULL,
	`status` text NOT NULL,
	`marked_by` integer,
	`marked_at` text NOT NULL,
	PRIMARY KEY(`meeting_id`, `user_id`),
	FOREIGN KEY (`meeting_id`) REFERENCES `meetings`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "attendance_status" CHECK("attendance"."status" IN ('present', 'late', 'excused', 'absent'))
);
--> statement-breakpoint
CREATE INDEX `attendance_user` ON `attendance` (`user_id`);--> statement-breakpoint
CREATE TABLE `job_runs` (
	`job` text NOT NULL,
	`scope` text NOT NULL,
	`period` text NOT NULL,
	`ran_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	PRIMARY KEY(`job`, `scope`, `period`)
);
--> statement-breakpoint
CREATE TABLE `meeting_schedules` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`group_id` integer NOT NULL,
	`weekday` integer NOT NULL,
	`start_time` text NOT NULL,
	`duration_min` integer DEFAULT 120 NOT NULL,
	`title` text NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`group_id`) REFERENCES `groups`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "meeting_schedules_weekday" CHECK("meeting_schedules"."weekday" BETWEEN 0 AND 6)
);
--> statement-breakpoint
CREATE INDEX `meeting_schedules_group` ON `meeting_schedules` (`group_id`);--> statement-breakpoint
CREATE TABLE `meetings` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`group_id` integer NOT NULL,
	`schedule_id` integer,
	`title` text NOT NULL,
	`starts_at` text NOT NULL,
	`ends_at` text NOT NULL,
	`status` text DEFAULT 'scheduled' NOT NULL,
	`guest_count` integer DEFAULT 0 NOT NULL,
	`notes` text,
	`roll_taken_by` integer,
	`roll_taken_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`group_id`) REFERENCES `groups`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`schedule_id`) REFERENCES `meeting_schedules`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "meetings_status" CHECK("meetings"."status" IN ('scheduled', 'done', 'cancelled'))
);
--> statement-breakpoint
CREATE INDEX `meetings_group_starts` ON `meetings` (`group_id`,`starts_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `meetings_schedule_starts` ON `meetings` (`schedule_id`,`starts_at`);--> statement-breakpoint
CREATE TABLE `outbox` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`chat_id` integer NOT NULL,
	`method` text NOT NULL,
	`payload` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`next_attempt_at` text NOT NULL,
	`last_error` text,
	`dedupe_key` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `outbox_dedupe_key_unique` ON `outbox` (`dedupe_key`);--> statement-breakpoint
CREATE INDEX `outbox_due` ON `outbox` (`status`,`next_attempt_at`);