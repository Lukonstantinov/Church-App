ALTER TABLE `groups` ADD `meeting_reminder_hours` integer;--> statement-breakpoint
ALTER TABLE `meetings` ADD `reminded_at` text;--> statement-breakpoint
UPDATE `meetings` SET `reminded_at` = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE `starts_at` <= strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '+2 hours');
