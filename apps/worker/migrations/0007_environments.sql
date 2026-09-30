CREATE TABLE `positions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`group_id` integer NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`permissions` text NOT NULL,
	`is_default` integer DEFAULT false NOT NULL,
	`sort` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`group_id`) REFERENCES `groups`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `positions_group` ON `positions` (`group_id`);--> statement-breakpoint
ALTER TABLE `groups` ADD `brand_color` text;--> statement-breakpoint
ALTER TABLE `groups` ADD `logo_media_id` integer;--> statement-breakpoint
ALTER TABLE `groups` ADD `sort` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `memberships` ADD `position_id` integer;--> statement-breakpoint
-- Every existing group gets the two starting positions; members keep their powers.
INSERT INTO `positions` (`group_id`, `name`, `description`, `permissions`, `is_default`, `sort`)
SELECT `id`, 'Лидер', 'Ведёт среду: все права', '["people.view","people.manage","attendance.take","meetings.manage","money.view","money.manage","events.manage","announce","reports","settings","positions"]', 0, 0 FROM `groups`;--> statement-breakpoint
INSERT INTO `positions` (`group_id`, `name`, `description`, `permissions`, `is_default`, `sort`)
SELECT `id`, 'Участник', NULL, '[]', 1, 1 FROM `groups`;--> statement-breakpoint
UPDATE `memberships` SET `position_id` = (
  SELECT p.`id` FROM `positions` p
  WHERE p.`group_id` = `memberships`.`group_id`
    AND p.`is_default` = (CASE WHEN `memberships`.`role` = 'leader' THEN 0 ELSE 1 END)
);
