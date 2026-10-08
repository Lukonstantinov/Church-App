ALTER TABLE `events` ADD `look_version` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `groups` ADD `event_template_id` integer;--> statement-breakpoint
ALTER TABLE `meetings` ADD `look_version` integer DEFAULT 0 NOT NULL;