ALTER TABLE `church_settings` ADD `sheet_label` text;--> statement-breakpoint
ALTER TABLE `event_roles` ADD `leader_user_id` integer REFERENCES users(id);