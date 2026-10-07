ALTER TABLE `groups` ADD `meeting_services` text;--> statement-breakpoint
ALTER TABLE `meeting_helpers` ADD `icon` text;--> statement-breakpoint
ALTER TABLE `meeting_helpers` ADD `speaker` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `meetings` ADD `people_look` text;