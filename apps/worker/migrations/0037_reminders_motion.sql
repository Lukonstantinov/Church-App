ALTER TABLE `groups` ADD `meeting_reminders` text;--> statement-breakpoint
ALTER TABLE `groups` ADD `meeting_motion` text;--> statement-breakpoint
ALTER TABLE `meetings` ADD `motion` text;--> statement-breakpoint
UPDATE `groups` SET `meeting_reminders` = '[]' WHERE `meeting_reminder_hours` = 0;--> statement-breakpoint
UPDATE `groups` SET `meeting_reminders` = '[' || (`meeting_reminder_hours` * 60) || ',60]' WHERE `meeting_reminder_hours` > 1;--> statement-breakpoint
UPDATE `groups` SET `meeting_reminders` = '[60]' WHERE `meeting_reminder_hours` = 1;--> statement-breakpoint
INSERT OR IGNORE INTO `job_runs` (`job`, `scope`, `period`) SELECT 'meeting_remind', CAST(`id` AS TEXT), '120:' || `starts_at` FROM `meetings` WHERE `reminded_at` IS NOT NULL AND `starts_at` > strftime('%Y-%m-%dT%H:%M:%fZ', 'now');
