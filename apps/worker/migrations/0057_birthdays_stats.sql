ALTER TABLE `church_settings` ADD `birthday_report` text;--> statement-breakpoint
ALTER TABLE `groups` ADD `stat_kinds` text;--> statement-breakpoint
ALTER TABLE `meeting_schedules` ADD `counts` integer;--> statement-breakpoint
ALTER TABLE `meetings` ADD `counts` integer;--> statement-breakpoint
ALTER TABLE `users` ADD `birthday` text;--> statement-breakpoint
ALTER TABLE `users` ADD `birth_year` integer;