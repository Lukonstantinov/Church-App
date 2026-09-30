CREATE TABLE `audit_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`actor_user_id` integer,
	`action` text NOT NULL,
	`entity` text NOT NULL,
	`entity_id` integer,
	`group_id` integer,
	`data` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `audit_log_entity` ON `audit_log` (`entity`,`entity_id`);--> statement-breakpoint
CREATE TABLE `church_settings` (
	`id` integer PRIMARY KEY NOT NULL,
	`name` text DEFAULT 'Церковь' NOT NULL,
	`timezone` text DEFAULT 'Europe/Riga' NOT NULL,
	`currency` text DEFAULT 'EUR' NOT NULL,
	`privacy_version` integer DEFAULT 1 NOT NULL,
	`admin_backup_chat_id` integer,
	CONSTRAINT "church_settings_singleton" CHECK("church_settings"."id" = 1)
);
--> statement-breakpoint
CREATE TABLE `groups` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`invite_code` text NOT NULL,
	`inactivity_threshold` integer DEFAULT 3 NOT NULL,
	`checkin_template` text,
	`members_see_treasury` integer DEFAULT false NOT NULL,
	`archived_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `groups_invite_code_unique` ON `groups` (`invite_code`);--> statement-breakpoint
CREATE TABLE `memberships` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`group_id` integer NOT NULL,
	`role` text DEFAULT 'member' NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`joined_at` text,
	`left_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`group_id`) REFERENCES `groups`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "memberships_role" CHECK("memberships"."role" IN ('leader', 'member')),
	CONSTRAINT "memberships_status" CHECK("memberships"."status" IN ('pending', 'active', 'left', 'rejected'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `memberships_user_group` ON `memberships` (`user_id`,`group_id`);--> statement-breakpoint
CREATE INDEX `memberships_group_status` ON `memberships` (`group_id`,`status`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`telegram_id` integer,
	`first_name` text NOT NULL,
	`last_name` text,
	`username` text,
	`language_code` text,
	`is_admin` integer DEFAULT false NOT NULL,
	`is_reachable` integer DEFAULT true NOT NULL,
	`privacy_accepted_at` text,
	`privacy_version` integer,
	`guardian_consent_at` text,
	`guardian_consent_by` integer,
	`claim_code` text,
	`claim_expires_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`anonymized_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_telegram_id_unique` ON `users` (`telegram_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `users_claim_code_unique` ON `users` (`claim_code`);
--> statement-breakpoint
INSERT INTO `church_settings` (`id`) VALUES (1);
