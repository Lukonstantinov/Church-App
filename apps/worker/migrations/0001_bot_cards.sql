CREATE TABLE `bot_cards` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`kind` text NOT NULL,
	`ref_id` integer NOT NULL,
	`chat_id` integer NOT NULL,
	`message_id` integer NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `bot_cards_ref` ON `bot_cards` (`kind`,`ref_id`);