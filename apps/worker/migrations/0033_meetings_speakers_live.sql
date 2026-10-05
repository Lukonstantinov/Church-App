ALTER TABLE `events` ADD `live_notified_at` text;--> statement-breakpoint
ALTER TABLE `events` ADD `speakers` text;--> statement-breakpoint
ALTER TABLE `meetings` ADD `design` text;--> statement-breakpoint
ALTER TABLE `meetings` ADD `speakers` text;--> statement-breakpoint
ALTER TABLE `meetings` ADD `series_id` text;--> statement-breakpoint
ALTER TABLE `meetings` ADD `repeat_rule` text;--> statement-breakpoint
ALTER TABLE `meetings` ADD `live_notified_at` text;--> statement-breakpoint
UPDATE `meetings` SET `kind` = NULL WHERE `kind` = 'leaders';--> statement-breakpoint
UPDATE `meetings` SET `live_notified_at` = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE `starts_at` <= strftime('%Y-%m-%dT%H:%M:%fZ', 'now');--> statement-breakpoint
UPDATE `events` SET `live_notified_at` = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE `starts_at` <= strftime('%Y-%m-%dT%H:%M:%fZ', 'now');
