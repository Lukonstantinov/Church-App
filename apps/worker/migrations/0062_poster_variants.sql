ALTER TABLE `poster_templates` ADD `variants` text;--> statement-breakpoint
ALTER TABLE `poster_templates` ADD `event_only` integer DEFAULT false NOT NULL;