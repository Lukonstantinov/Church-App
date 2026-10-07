CREATE TABLE `live_pins` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`chat_id` integer NOT NULL,
	`message_id` integer NOT NULL,
	`kind` text NOT NULL,
	`ref_id` integer NOT NULL,
	`ends_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `live_pins_ends` ON `live_pins` (`ends_at`);