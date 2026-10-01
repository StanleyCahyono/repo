CREATE TABLE `airports` (
	`iata` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`city` text,
	`lat` real NOT NULL,
	`lon` real NOT NULL,
	`timezone` text,
	`role` text NOT NULL,
	`official_url` text,
	`airlines_url` text,
	`airlines` text NOT NULL,
	`parking` text,
	`drive_from_home` text,
	`notes` text,
	`prov` text
);
--> statement-breakpoint
CREATE TABLE `alert_rules` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`type` text NOT NULL,
	`resort_id` text,
	`params` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`cooldown_hours` integer DEFAULT 12 NOT NULL,
	`last_fired_at` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `alerts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`rule_id` integer,
	`type` text NOT NULL,
	`dedupe_key` text NOT NULL,
	`resort_id` text,
	`title` text NOT NULL,
	`body` text NOT NULL,
	`link` text,
	`fired_at` text NOT NULL,
	`read_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `alerts_dedupe_key_unique` ON `alerts` (`dedupe_key`);--> statement-breakpoint
CREATE TABLE `app_meta` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `checklist_templates` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`label` text NOT NULL,
	`category` text,
	`sort_order` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `conditions_assessments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`resort_id` text NOT NULL,
	`local_date` text NOT NULL,
	`mode` text NOT NULL,
	`model_version` text NOT NULL,
	`computed_at` text NOT NULL,
	`kind` text NOT NULL,
	`score_kind` text NOT NULL,
	`score` integer,
	`descriptor` text,
	`coverage` real NOT NULL,
	`components` text NOT NULL,
	`surface` text NOT NULL,
	`confidence` text NOT NULL,
	`confidence_reasons` text NOT NULL,
	`eligibility` text NOT NULL,
	`lead_days` integer,
	`explanation` text NOT NULL,
	`inputs` text NOT NULL,
	FOREIGN KEY (`resort_id`) REFERENCES `resorts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `assessments_resort_date` ON `conditions_assessments` (`resort_id`,`local_date`,`mode`);--> statement-breakpoint
CREATE TABLE `events` (
	`id` text PRIMARY KEY NOT NULL,
	`resort_id` text,
	`title` text NOT NULL,
	`category` text NOT NULL,
	`venue` text,
	`start_local` text,
	`end_local` text,
	`timezone` text NOT NULL,
	`status` text NOT NULL,
	`last_edition` text,
	`ticket_url` text,
	`price_minor` integer,
	`currency` text,
	`age_restriction` text,
	`booking_required` integer,
	`official_url` text,
	`dedupe_key` text NOT NULL,
	`origin` text DEFAULT 'catalog' NOT NULL,
	`last_verified_at` text,
	`prov` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `events_dedupe` ON `events` (`dedupe_key`);--> statement-breakpoint
CREATE INDEX `events_resort` ON `events` (`resort_id`);--> statement-breakpoint
CREATE TABLE `expenses` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`date` text NOT NULL,
	`category` text NOT NULL,
	`label` text NOT NULL,
	`amount_minor` integer NOT NULL,
	`currency` text NOT NULL,
	`trip_id` text,
	`pass_ownership_id` integer,
	`notes` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `favorites` (
	`resort_id` text PRIMARY KEY NOT NULL,
	`added_at` text NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`resort_id`) REFERENCES `resorts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `fx_rates` (
	`base` text NOT NULL,
	`quote` text NOT NULL,
	`rate` text NOT NULL,
	`rate_date` text NOT NULL,
	`provider` text NOT NULL,
	`fetched_at` text NOT NULL,
	`kind` text NOT NULL,
	PRIMARY KEY(`base`, `quote`, `rate_date`)
);
--> statement-breakpoint
CREATE TABLE `gear` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`type` text NOT NULL,
	`brand_model` text NOT NULL,
	`size` text,
	`bought_on` text,
	`notes` text,
	`color` text,
	`photo` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `hotels` (
	`id` text PRIMARY KEY NOT NULL,
	`resort_id` text NOT NULL,
	`name` text NOT NULL,
	`tier` text,
	`brand` text,
	`address` text,
	`lat` real,
	`lon` real,
	`official_url` text,
	`distance_text` text,
	`ski_in_out` text DEFAULT 'unknown' NOT NULL,
	`shuttle` text,
	`parking` text,
	`notes` text,
	`origin` text DEFAULT 'catalog' NOT NULL,
	`prov` text,
	FOREIGN KEY (`resort_id`) REFERENCES `resorts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `lessons` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`resort_id` text NOT NULL,
	`trip_id` text,
	`date` text,
	`kind` text,
	`instructor` text,
	`focus_skills` text NOT NULL,
	`booking_ref` text,
	`booking_url` text,
	`cost_minor` integer,
	`currency` text,
	`cost_kind` text,
	`notes` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `link_checks` (
	`url` text PRIMARY KEY NOT NULL,
	`checked_at` text NOT NULL,
	`http_status` integer,
	`ok` integer,
	`final_url` text,
	`error` text,
	`embeddable` integer
);
--> statement-breakpoint
CREATE TABLE `my_ratings` (
	`resort_id` text PRIMARY KEY NOT NULL,
	`rating` integer,
	`review` text,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`resort_id`) REFERENCES `resorts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `opening_date_history` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`resort_id` text NOT NULL,
	`season_id` text NOT NULL,
	`field` text NOT NULL,
	`previous_value` text,
	`new_value` text,
	`changed_at` text NOT NULL,
	`prov` text
);
--> statement-breakpoint
CREATE TABLE `operating_schedules` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`resort_id` text NOT NULL,
	`season_id` text,
	`activity` text NOT NULL,
	`label` text NOT NULL,
	`days_of_week` text,
	`start_date` text,
	`end_date` text,
	`exception_date` text,
	`opens` text,
	`closes` text,
	`closed` integer DEFAULT false NOT NULL,
	`nature` text DEFAULT 'published' NOT NULL,
	`prov` text,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`resort_id`) REFERENCES `resorts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `schedules_resort` ON `operating_schedules` (`resort_id`);--> statement-breakpoint
CREATE TABLE `operational_reports` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`resort_id` text NOT NULL,
	`local_date` text NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`kind` text NOT NULL,
	`reported_at` text,
	`fetched_at` text,
	`status` text,
	`snowfall` text NOT NULL,
	`base_depth_cm` real,
	`base_depth_location` text,
	`summit_depth_cm` real,
	`surface_tags` text NOT NULL,
	`surface_text` text,
	`grooming_text` text,
	`groomed_runs` integer,
	`snowmaking_text` text,
	`open_trails` integer,
	`total_trails` integer,
	`open_lifts` integer,
	`total_lifts` integer,
	`open_beginner_trails` integer,
	`total_beginner_trails` integer,
	`open_acres` real,
	`notes` text,
	`content_hash` text,
	`prov` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`resort_id`) REFERENCES `resorts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `reports_resort_date` ON `operational_reports` (`resort_id`,`local_date`);--> statement-breakpoint
CREATE INDEX `reports_hash` ON `operational_reports` (`resort_id`,`content_hash`);--> statement-breakpoint
CREATE TABLE `pass_access_rules` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`product_id` text NOT NULL,
	`resort_id` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`access` text NOT NULL,
	`days` integer,
	`pool_id` text,
	`pool_label` text,
	`blackouts` text NOT NULL,
	`reservation_required` integer,
	`reservation_notes` text,
	`discount_text` text,
	`eligibility_notes` text,
	`notes` text,
	`prov` text,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`product_id`) REFERENCES `pass_products`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `access_product_resort` ON `pass_access_rules` (`product_id`,`resort_id`);--> statement-breakpoint
CREATE TABLE `pass_families` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`operator` text,
	`links` text NOT NULL,
	`prov` text
);
--> statement-breakpoint
CREATE TABLE `pass_ownership` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`product_id` text NOT NULL,
	`holder` text DEFAULT 'me' NOT NULL,
	`purchased_on` text,
	`price_paid_minor` integer,
	`currency` text,
	`notes` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`product_id`) REFERENCES `pass_products`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `pass_products` (
	`id` text PRIMARY KEY NOT NULL,
	`family_id` text NOT NULL,
	`season_id` text NOT NULL,
	`name` text NOT NULL,
	`resort_id` text,
	`summary` text,
	`blackouts_summary` text,
	`reservations_summary` text,
	`sales_deadline` text,
	`sales_deadline_text` text,
	`renewal_notes` text,
	`version` integer DEFAULT 1 NOT NULL,
	`prov` text,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`family_id`) REFERENCES `pass_families`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `pass_usage` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`ownership_id` integer NOT NULL,
	`resort_id` text NOT NULL,
	`date` text NOT NULL,
	`notes` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`ownership_id`) REFERENCES `pass_ownership`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `price_snapshots` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`subject_type` text NOT NULL,
	`subject_id` text NOT NULL,
	`resort_id` text,
	`item` text NOT NULL,
	`category` text,
	`amount_minor` integer NOT NULL,
	`amount_max_minor` integer,
	`currency` text NOT NULL,
	`season_id` text,
	`day_type` text,
	`applies_from` text,
	`applies_to` text,
	`purchase_by` text,
	`includes_tax` integer,
	`fees_text` text,
	`quote_kind` text NOT NULL,
	`observed_at` text NOT NULL,
	`expires_at` text,
	`prov` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `prices_subject` ON `price_snapshots` (`subject_type`,`subject_id`);--> statement-breakpoint
CREATE TABLE `refresh_runs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`job` text NOT NULL,
	`target` text,
	`trigger` text NOT NULL,
	`started_at` text NOT NULL,
	`finished_at` text,
	`status` text NOT NULL,
	`attempts` integer DEFAULT 1 NOT NULL,
	`items_written` integer DEFAULT 0 NOT NULL,
	`error` text,
	`details` text
);
--> statement-breakpoint
CREATE INDEX `refresh_job_target` ON `refresh_runs` (`job`,`target`,`started_at`);--> statement-breakpoint
CREATE TABLE `resort_overrides` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`resort_id` text NOT NULL,
	`field` text NOT NULL,
	`value` text,
	`note` text,
	`source_url` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`resort_id`) REFERENCES `resorts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `resort_seasons` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`resort_id` text NOT NULL,
	`season_id` text NOT NULL,
	`announced_opening` text,
	`announced_opening_text` text,
	`announced_opening_on` text,
	`announced_opening_prov` text,
	`estimated_open_from` text,
	`estimated_open_to` text,
	`estimate_basis` text,
	`actual_opening` text,
	`actual_opening_prov` text,
	`announced_closing` text,
	`announced_closing_text` text,
	`announced_closing_prov` text,
	`actual_closing` text,
	`actual_closing_prov` text,
	`typical_opening_text` text,
	`notes` text,
	`last_checked_at` text,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`resort_id`) REFERENCES `resorts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`season_id`) REFERENCES `seasons`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `resort_seasons_resort_season` ON `resort_seasons` (`resort_id`,`season_id`);--> statement-breakpoint
CREATE TABLE `resorts` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`short_name` text NOT NULL,
	`country` text NOT NULL,
	`region` text NOT NULL,
	`state_province` text,
	`locality` text,
	`timezone` text NOT NULL,
	`operator` text,
	`lat` real NOT NULL,
	`lon` real NOT NULL,
	`location_prov` text,
	`base_elevation_m` real,
	`summit_elevation_m` real,
	`vertical_m` real,
	`elevation_prov` text,
	`terrain` text,
	`features` text,
	`character` text,
	`learning` text,
	`links` text NOT NULL,
	`weather_points` text NOT NULL,
	`report_source` text,
	`research` text,
	`photo` text,
	`priority` integer DEFAULT 0 NOT NULL,
	`origin` text DEFAULT 'catalog' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `seasons` (
	`id` text PRIMARY KEY NOT NULL,
	`label` text NOT NULL,
	`start_date` text NOT NULL,
	`end_date` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `ski_day_logs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`date` text NOT NULL,
	`resort_id` text NOT NULL,
	`trip_id` text,
	`rating` integer,
	`surface_feedback` text NOT NULL,
	`preferred_time` text,
	`crowd_guess` text,
	`skills_practiced` text NOT NULL,
	`hours_skied` real,
	`vertical_m` real,
	`spend_minor` integer,
	`currency` text,
	`notes` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `skill_checklist` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`label` text NOT NULL,
	`category` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'not-started' NOT NULL,
	`confirmed_on` text,
	`notes` text
);
--> statement-breakpoint
CREATE TABLE `source_records` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`adapter` text NOT NULL,
	`adapter_version` text,
	`resort_id` text,
	`url` text NOT NULL,
	`fetched_at` text NOT NULL,
	`http_status` integer,
	`ok` integer NOT NULL,
	`content_hash` text,
	`extract` text,
	`error` text,
	`parser_errors` text
);
--> statement-breakpoint
CREATE INDEX `source_records_adapter` ON `source_records` (`adapter`,`resort_id`,`fetched_at`);--> statement-breakpoint
CREATE TABLE `status_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`resort_id` text NOT NULL,
	`status` text NOT NULL,
	`effective_at` text NOT NULL,
	`local_date` text NOT NULL,
	`note` text,
	`prov` text NOT NULL,
	FOREIGN KEY (`resort_id`) REFERENCES `resorts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `status_resort_time` ON `status_events` (`resort_id`,`effective_at`);--> statement-breakpoint
CREATE TABLE `travel_options` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`resort_id` text NOT NULL,
	`mode` text NOT NULL,
	`airport_iata` text,
	`role` text,
	`name` text,
	`transfer_type` text,
	`minutes` integer,
	`km` real,
	`basis` text,
	`url` text,
	`notes` text,
	`prov` text,
	FOREIGN KEY (`resort_id`) REFERENCES `resorts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `travel_resort` ON `travel_options` (`resort_id`);--> statement-breakpoint
CREATE TABLE `trip_checklist` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`trip_id` text NOT NULL,
	`label` text NOT NULL,
	`category` text,
	`done` integer DEFAULT false NOT NULL,
	`link` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`trip_id`) REFERENCES `trips`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `trip_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`trip_id` text NOT NULL,
	`type` text NOT NULL,
	`ref_id` text,
	`title` text NOT NULL,
	`date` text,
	`end_date` text,
	`status` text DEFAULT 'draft' NOT NULL,
	`cost_minor` integer,
	`cost_max_minor` integer,
	`currency` text,
	`cost_kind` text,
	`cost_basis` text DEFAULT 'per-person' NOT NULL,
	`fx_rate` text,
	`fx_date` text,
	`quote_expires_at` text,
	`details` text NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`trip_id`) REFERENCES `trips`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `trip_items_trip` ON `trip_items` (`trip_id`);--> statement-breakpoint
CREATE TABLE `trips` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`start_date` text NOT NULL,
	`end_date` text NOT NULL,
	`party_size` integer DEFAULT 1 NOT NULL,
	`origin_airport` text,
	`companions` text NOT NULL,
	`notes` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `user_preferences` (
	`id` integer PRIMARY KEY NOT NULL,
	`home_name` text NOT NULL,
	`home_lat` real NOT NULL,
	`home_lon` real NOT NULL,
	`home_timezone` text NOT NULL,
	`active_season_id` text NOT NULL,
	`ability` text NOT NULL,
	`companion_ability` text,
	`companion_name` text,
	`units` text NOT NULL,
	`currency` text NOT NULL,
	`scoring_mode` text NOT NULL,
	`travel` text NOT NULL,
	`gear` text NOT NULL,
	`budget` text NOT NULL,
	`lodging_style` text,
	`weights` text NOT NULL,
	`theme` text DEFAULT 'system' NOT NULL,
	`avatar` text,
	`onboarding_done` integer DEFAULT false NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `weather_alerts` (
	`id` text PRIMARY KEY NOT NULL,
	`resort_id` text NOT NULL,
	`provider` text NOT NULL,
	`event` text NOT NULL,
	`headline` text,
	`severity` text,
	`onset` text,
	`ends` text,
	`url` text,
	`fetched_at` text NOT NULL,
	FOREIGN KEY (`resort_id`) REFERENCES `resorts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `weather_points` (
	`run_id` integer NOT NULL,
	`valid_time` text NOT NULL,
	`local_date` text NOT NULL,
	`temperature_c` real,
	`apparent_temperature_c` real,
	`snowfall_cm` real,
	`rain_mm` real,
	`precipitation_mm` real,
	`wind_kmh` real,
	`gust_kmh` real,
	`humidity_pct` real,
	`visibility_m` real,
	`cloud_cover_pct` real,
	`freezing_level_m` real,
	`snow_depth_m` real,
	`weather_code` integer,
	`is_day` integer,
	PRIMARY KEY(`run_id`, `valid_time`),
	FOREIGN KEY (`run_id`) REFERENCES `weather_runs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `weather_points_date` ON `weather_points` (`run_id`,`local_date`);--> statement-breakpoint
CREATE TABLE `weather_runs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`resort_id` text NOT NULL,
	`point_key` text NOT NULL,
	`provider` text NOT NULL,
	`model` text,
	`kind` text NOT NULL,
	`requested_lat` real NOT NULL,
	`requested_lon` real NOT NULL,
	`requested_elevation_m` real,
	`grid_lat` real,
	`grid_lon` real,
	`grid_elevation_m` real,
	`fetched_at` text NOT NULL,
	`model_run_at` text,
	`timezone` text NOT NULL,
	`horizon_days` integer,
	`variables` text NOT NULL,
	`units` text NOT NULL,
	`interval_semantics` text,
	`status` text NOT NULL,
	`error` text,
	`prov` text NOT NULL,
	FOREIGN KEY (`resort_id`) REFERENCES `resorts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `weather_runs_resort` ON `weather_runs` (`resort_id`,`point_key`,`fetched_at`);