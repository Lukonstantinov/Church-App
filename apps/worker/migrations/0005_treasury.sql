CREATE TABLE `media` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`group_id` integer,
	`kind` text NOT NULL,
	`mime` text NOT NULL,
	`data` text NOT NULL,
	`bytes` integer NOT NULL,
	`created_by` integer,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`group_id`) REFERENCES `groups`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `media_group` ON `media` (`group_id`);--> statement-breakpoint
CREATE TABLE `transactions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`group_id` integer NOT NULL,
	`kind` text NOT NULL,
	`amount_cents` integer NOT NULL,
	`occurred_on` text NOT NULL,
	`member_user_id` integer,
	`period` text,
	`category` text,
	`note` text,
	`event_id` integer,
	`receipt_media_id` integer,
	`created_by` integer,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`voided_at` text,
	`voided_by` integer,
	FOREIGN KEY (`group_id`) REFERENCES `groups`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`member_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`receipt_media_id`) REFERENCES `media`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "transactions_amount" CHECK("transactions"."amount_cents" > 0),
	CONSTRAINT "transactions_kind" CHECK("transactions"."kind" IN ('income', 'expense', 'donation', 'dues', 'event_payment', 'event_expense'))
);
--> statement-breakpoint
CREATE INDEX `transactions_group_date` ON `transactions` (`group_id`,`occurred_on`);--> statement-breakpoint
CREATE INDEX `transactions_member` ON `transactions` (`member_user_id`);--> statement-breakpoint
CREATE INDEX `transactions_event` ON `transactions` (`event_id`);--> statement-breakpoint
ALTER TABLE `groups` ADD `monthly_fee_cents` integer DEFAULT 500 NOT NULL;--> statement-breakpoint
ALTER TABLE `memberships` ADD `dues_exempt` integer DEFAULT false NOT NULL;