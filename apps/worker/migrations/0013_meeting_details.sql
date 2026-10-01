DROP INDEX `meetings_schedule_starts`;--> statement-breakpoint
ALTER TABLE `meetings` ADD `location` text;--> statement-breakpoint
ALTER TABLE `meetings` ADD `topic` text;--> statement-breakpoint
ALTER TABLE `meetings` ADD `kind` text;--> statement-breakpoint
ALTER TABLE `meetings` ADD `leader_user_id` integer REFERENCES users(id);--> statement-breakpoint
ALTER TABLE `meetings` ADD `snack_user_id` integer REFERENCES users(id);--> statement-breakpoint
ALTER TABLE `meetings` ADD `budget_cents` integer;--> statement-breakpoint
ALTER TABLE `meetings` ADD `slot_at` text;--> statement-breakpoint
-- Existing schedule meetings keep their slot (the time they were generated for).
UPDATE `meetings` SET `slot_at` = `starts_at` WHERE `schedule_id` IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `meetings_schedule_slot` ON `meetings` (`schedule_id`,`slot_at`);--> statement-breakpoint
ALTER TABLE `groups` ADD `meeting_budget_cents` integer DEFAULT 1500 NOT NULL;--> statement-breakpoint
ALTER TABLE `transactions` ADD `meeting_id` integer;--> statement-breakpoint
CREATE INDEX `transactions_meeting` ON `transactions` (`meeting_id`);