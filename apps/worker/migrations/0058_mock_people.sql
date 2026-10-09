ALTER TABLE `church_settings` ADD `mock_only` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `is_mock` integer DEFAULT false NOT NULL;