CREATE TYPE "public"."delivery_method" AS ENUM('delivery', 'pickup');--> statement-breakpoint
CREATE TYPE "public"."delivery_status" AS ENUM('awaiting', 'processing', 'ready_for_collection', 'dispatched', 'delivered', 'failed');--> statement-breakpoint
CREATE TYPE "public"."event_type" AS ENUM('introduction', 'traditional', 'white', 'reception', 'after_party', 'other');--> statement-breakpoint
CREATE TYPE "public"."file_visibility" AS ENUM('public', 'private');--> statement-breakpoint
CREATE TYPE "public"."member_role" AS ENUM('owner', 'partner', 'planner', 'viewer');--> statement-breakpoint
CREATE TYPE "public"."notify_channel" AS ENUM('email', 'whatsapp', 'in_app');--> statement-breakpoint
CREATE TYPE "public"."notify_status" AS ENUM('queued', 'sent', 'failed', 'skipped');--> statement-breakpoint
CREATE TYPE "public"."order_status" AS ENUM('pending_payment', 'partially_paid', 'paid', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."payment_status" AS ENUM('initialized', 'pending', 'success', 'failed', 'abandoned', 'refunded');--> statement-breakpoint
CREATE TYPE "public"."recurrence" AS ENUM('none', 'weekly', 'monthly');--> statement-breakpoint
CREATE TYPE "public"."task_assignee" AS ENUM('partner_one', 'partner_two', 'both');--> statement-breakpoint
CREATE TYPE "public"."task_kind" AS ENUM('task', 'activity');--> statement-breakpoint
CREATE TYPE "public"."task_priority" AS ENUM('low', 'medium', 'high');--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"wedding_id" uuid NOT NULL,
	"user_id" uuid,
	"actor" text DEFAULT 'user' NOT NULL,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text,
	"summary" text NOT NULL,
	"before" jsonb,
	"after" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "asoebi_campaign_images" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"file_id" uuid NOT NULL,
	"caption" text,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "asoebi_campaigns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"wedding_id" uuid NOT NULL,
	"event_id" uuid,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"fabric_name" text NOT NULL,
	"colour_story" text,
	"description" text,
	"instructions" text,
	"sales_open_at" date,
	"sales_close_at" date,
	"payment_deadline" date,
	"allow_instalments" boolean DEFAULT false NOT NULL,
	"min_deposit_percent" integer DEFAULT 50 NOT NULL,
	"allow_delivery" boolean DEFAULT true NOT NULL,
	"allow_pickup" boolean DEFAULT true NOT NULL,
	"delivery_fee" bigint DEFAULT 0 NOT NULL,
	"pickup_details" text,
	"delivery_details" text,
	"contact_name" text,
	"contact_phone" text,
	"accent" text DEFAULT '#8E5B5B' NOT NULL,
	"is_published" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "asoebi_campaigns_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"wedding_id" uuid NOT NULL,
	"name" text NOT NULL,
	"color" text DEFAULT '#B89B6A' NOT NULL,
	"allocated" bigint DEFAULT 0 NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "deliveries" (
	"order_id" uuid PRIMARY KEY NOT NULL,
	"wedding_id" uuid NOT NULL,
	"status" "delivery_status" DEFAULT 'awaiting' NOT NULL,
	"rider_name" text,
	"rider_phone" text,
	"tracking_ref" text,
	"notes" text,
	"dispatched_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "delivery_addresses" (
	"order_id" uuid PRIMARY KEY NOT NULL,
	"street" text NOT NULL,
	"area" text NOT NULL,
	"city" text NOT NULL,
	"state" text NOT NULL,
	"landmark" text,
	"instructions" text,
	"source" text DEFAULT 'web' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"wedding_id" uuid NOT NULL,
	"name" text NOT NULL,
	"type" "event_type" DEFAULT 'other' NOT NULL,
	"date" date,
	"venue" text,
	"budget" bigint,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "expense_attachments" (
	"expense_id" uuid NOT NULL,
	"file_id" uuid NOT NULL,
	CONSTRAINT "expense_attachments_expense_id_file_id_pk" PRIMARY KEY("expense_id","file_id")
);
--> statement-breakpoint
CREATE TABLE "expense_payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"wedding_id" uuid NOT NULL,
	"expense_id" uuid NOT NULL,
	"instalment_id" uuid,
	"amount" bigint NOT NULL,
	"paid_on" date NOT NULL,
	"method" text DEFAULT 'transfer' NOT NULL,
	"reference" text,
	"evidence_file_id" uuid,
	"note" text,
	"recorded_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "expenses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"wedding_id" uuid NOT NULL,
	"event_id" uuid,
	"category_id" uuid,
	"vendor_id" uuid,
	"name" text NOT NULL,
	"description" text,
	"estimated_cost" bigint DEFAULT 0 NOT NULL,
	"actual_cost" bigint,
	"due_date" date,
	"cancelled_at" timestamp with time zone,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"wedding_id" uuid NOT NULL,
	"storage_key" text NOT NULL,
	"filename" text NOT NULL,
	"mime_type" text NOT NULL,
	"size" integer NOT NULL,
	"visibility" "file_visibility" DEFAULT 'private' NOT NULL,
	"uploaded_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "files_storage_key_unique" UNIQUE("storage_key")
);
--> statement-breakpoint
CREATE TABLE "guests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"wedding_id" uuid NOT NULL,
	"name" text NOT NULL,
	"email" text,
	"phone" text,
	"category" text DEFAULT 'Friends' NOT NULL,
	"invite_token" text NOT NULL,
	"invited_at" timestamp with time zone,
	"link_sent_at" timestamp with time zone,
	"link_opened_at" timestamp with time zone,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "guests_invite_token_unique" UNIQUE("invite_token")
);
--> statement-breakpoint
CREATE TABLE "instalments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"wedding_id" uuid NOT NULL,
	"expense_id" uuid NOT NULL,
	"label" text NOT NULL,
	"amount" bigint NOT NULL,
	"due_date" date NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"wedding_id" uuid NOT NULL,
	"email" text NOT NULL,
	"role" "member_role" DEFAULT 'partner' NOT NULL,
	"token_hash" text NOT NULL,
	"accepted_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invites_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "memberships" (
	"user_id" uuid NOT NULL,
	"wedding_id" uuid NOT NULL,
	"role" "member_role" DEFAULT 'owner' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "memberships_user_id_wedding_id_pk" PRIMARY KEY("user_id","wedding_id")
);
--> statement-breakpoint
CREATE TABLE "notification_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"wedding_id" uuid NOT NULL,
	"channel" "notify_channel" NOT NULL,
	"type" text NOT NULL,
	"trigger" text NOT NULL,
	"recipient" text NOT NULL,
	"subject" text,
	"body" text NOT NULL,
	"html" text,
	"status" "notify_status" DEFAULT 'queued' NOT NULL,
	"error" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"provider_id" text,
	"dedupe_key" text,
	"entity_type" text,
	"entity_id" uuid,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"wedding_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"body" text,
	"href" text,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "asoebi_order_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"package_id" uuid,
	"package_name" text NOT NULL,
	"unit_price" bigint NOT NULL,
	"quantity" integer NOT NULL,
	"line_total" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "asoebi_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"wedding_id" uuid NOT NULL,
	"campaign_id" uuid NOT NULL,
	"guest_id" uuid,
	"code" text NOT NULL,
	"access_token" text NOT NULL,
	"full_name" text NOT NULL,
	"phone" text NOT NULL,
	"email" text NOT NULL,
	"status" "order_status" DEFAULT 'pending_payment' NOT NULL,
	"delivery_method" "delivery_method" NOT NULL,
	"subtotal" bigint NOT NULL,
	"delivery_fee" bigint DEFAULT 0 NOT NULL,
	"total" bigint NOT NULL,
	"amount_paid" bigint DEFAULT 0 NOT NULL,
	"payment_plan" text DEFAULT 'full' NOT NULL,
	"cancelled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "asoebi_orders_code_unique" UNIQUE("code"),
	CONSTRAINT "asoebi_orders_access_token_unique" UNIQUE("access_token")
);
--> statement-breakpoint
CREATE TABLE "asoebi_packages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"wedding_id" uuid NOT NULL,
	"campaign_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"price" bigint NOT NULL,
	"quantity_available" integer,
	"max_per_order" integer DEFAULT 10 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"wedding_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"reference" text NOT NULL,
	"amount" bigint NOT NULL,
	"currency" text DEFAULT 'NGN' NOT NULL,
	"status" "payment_status" DEFAULT 'initialized' NOT NULL,
	"channel" text,
	"gateway_response" text,
	"authorization_url" text,
	"paid_at" timestamp with time zone,
	"verified_at" timestamp with time zone,
	"applied_at" timestamp with time zone,
	"refunded_at" timestamp with time zone,
	"raw" jsonb,
	"recorded_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payments_reference_unique" UNIQUE("reference")
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"token_hash" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"wedding_id" uuid NOT NULL,
	"event_id" uuid,
	"title" text NOT NULL,
	"description" text,
	"kind" "task_kind" DEFAULT 'task' NOT NULL,
	"due_date" date,
	"assignee" "task_assignee" DEFAULT 'both' NOT NULL,
	"priority" "task_priority" DEFAULT 'medium' NOT NULL,
	"recurrence" "recurrence" DEFAULT 'none' NOT NULL,
	"remind_days_before" integer[] DEFAULT '{1}'::int[] NOT NULL,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"phone" text,
	"password_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "vendors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"wedding_id" uuid NOT NULL,
	"category_id" uuid,
	"name" text NOT NULL,
	"contact_name" text,
	"phone" text,
	"email" text,
	"address" text,
	"instagram" text,
	"notes" text,
	"contract_file_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webhook_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" text NOT NULL,
	"event" text NOT NULL,
	"dedupe_key" text NOT NULL,
	"signature_valid" boolean NOT NULL,
	"payload" jsonb NOT NULL,
	"result" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "weddings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"partner_one_name" text NOT NULL,
	"partner_two_name" text NOT NULL,
	"partner_one_email" text,
	"partner_two_email" text,
	"partner_one_phone" text,
	"partner_two_phone" text,
	"wedding_date" date,
	"traditional_date" date,
	"white_wedding_date" date,
	"venue" text,
	"city" text,
	"estimated_guests" integer,
	"total_budget" bigint DEFAULT 0 NOT NULL,
	"currency" text DEFAULT 'NGN' NOT NULL,
	"onboarded_at" timestamp with time zone,
	"reminder_offsets" integer[] DEFAULT '{7,3,0}'::int[] NOT NULL,
	"overdue_repeat_days" integer DEFAULT 3 NOT NULL,
	"notify_email" boolean DEFAULT true NOT NULL,
	"notify_whatsapp" boolean DEFAULT false NOT NULL,
	"notify_in_app" boolean DEFAULT true NOT NULL,
	"guest_reminder_days" integer DEFAULT 3 NOT NULL,
	"sheets_feed_token" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "weddings_sheets_feed_token_unique" UNIQUE("sheets_feed_token")
);
--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_wedding_id_weddings_id_fk" FOREIGN KEY ("wedding_id") REFERENCES "public"."weddings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asoebi_campaign_images" ADD CONSTRAINT "asoebi_campaign_images_campaign_id_asoebi_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."asoebi_campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asoebi_campaign_images" ADD CONSTRAINT "asoebi_campaign_images_file_id_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."files"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asoebi_campaigns" ADD CONSTRAINT "asoebi_campaigns_wedding_id_weddings_id_fk" FOREIGN KEY ("wedding_id") REFERENCES "public"."weddings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asoebi_campaigns" ADD CONSTRAINT "asoebi_campaigns_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "categories_wedding_id_weddings_id_fk" FOREIGN KEY ("wedding_id") REFERENCES "public"."weddings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_order_id_asoebi_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."asoebi_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_wedding_id_weddings_id_fk" FOREIGN KEY ("wedding_id") REFERENCES "public"."weddings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_addresses" ADD CONSTRAINT "delivery_addresses_order_id_asoebi_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."asoebi_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_wedding_id_weddings_id_fk" FOREIGN KEY ("wedding_id") REFERENCES "public"."weddings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense_attachments" ADD CONSTRAINT "expense_attachments_expense_id_expenses_id_fk" FOREIGN KEY ("expense_id") REFERENCES "public"."expenses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense_attachments" ADD CONSTRAINT "expense_attachments_file_id_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."files"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense_payments" ADD CONSTRAINT "expense_payments_wedding_id_weddings_id_fk" FOREIGN KEY ("wedding_id") REFERENCES "public"."weddings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense_payments" ADD CONSTRAINT "expense_payments_expense_id_expenses_id_fk" FOREIGN KEY ("expense_id") REFERENCES "public"."expenses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense_payments" ADD CONSTRAINT "expense_payments_instalment_id_instalments_id_fk" FOREIGN KEY ("instalment_id") REFERENCES "public"."instalments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense_payments" ADD CONSTRAINT "expense_payments_evidence_file_id_files_id_fk" FOREIGN KEY ("evidence_file_id") REFERENCES "public"."files"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense_payments" ADD CONSTRAINT "expense_payments_recorded_by_users_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_wedding_id_weddings_id_fk" FOREIGN KEY ("wedding_id") REFERENCES "public"."weddings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_vendor_id_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendors"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_wedding_id_weddings_id_fk" FOREIGN KEY ("wedding_id") REFERENCES "public"."weddings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guests" ADD CONSTRAINT "guests_wedding_id_weddings_id_fk" FOREIGN KEY ("wedding_id") REFERENCES "public"."weddings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "instalments" ADD CONSTRAINT "instalments_wedding_id_weddings_id_fk" FOREIGN KEY ("wedding_id") REFERENCES "public"."weddings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "instalments" ADD CONSTRAINT "instalments_expense_id_expenses_id_fk" FOREIGN KEY ("expense_id") REFERENCES "public"."expenses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invites" ADD CONSTRAINT "invites_wedding_id_weddings_id_fk" FOREIGN KEY ("wedding_id") REFERENCES "public"."weddings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_wedding_id_weddings_id_fk" FOREIGN KEY ("wedding_id") REFERENCES "public"."weddings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_logs" ADD CONSTRAINT "notification_logs_wedding_id_weddings_id_fk" FOREIGN KEY ("wedding_id") REFERENCES "public"."weddings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_wedding_id_weddings_id_fk" FOREIGN KEY ("wedding_id") REFERENCES "public"."weddings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asoebi_order_items" ADD CONSTRAINT "asoebi_order_items_order_id_asoebi_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."asoebi_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asoebi_order_items" ADD CONSTRAINT "asoebi_order_items_package_id_asoebi_packages_id_fk" FOREIGN KEY ("package_id") REFERENCES "public"."asoebi_packages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asoebi_orders" ADD CONSTRAINT "asoebi_orders_wedding_id_weddings_id_fk" FOREIGN KEY ("wedding_id") REFERENCES "public"."weddings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asoebi_orders" ADD CONSTRAINT "asoebi_orders_campaign_id_asoebi_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."asoebi_campaigns"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asoebi_orders" ADD CONSTRAINT "asoebi_orders_guest_id_guests_id_fk" FOREIGN KEY ("guest_id") REFERENCES "public"."guests"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asoebi_packages" ADD CONSTRAINT "asoebi_packages_wedding_id_weddings_id_fk" FOREIGN KEY ("wedding_id") REFERENCES "public"."weddings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asoebi_packages" ADD CONSTRAINT "asoebi_packages_campaign_id_asoebi_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."asoebi_campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_wedding_id_weddings_id_fk" FOREIGN KEY ("wedding_id") REFERENCES "public"."weddings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_order_id_asoebi_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."asoebi_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_recorded_by_users_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_wedding_id_weddings_id_fk" FOREIGN KEY ("wedding_id") REFERENCES "public"."weddings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendors" ADD CONSTRAINT "vendors_wedding_id_weddings_id_fk" FOREIGN KEY ("wedding_id") REFERENCES "public"."weddings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendors" ADD CONSTRAINT "vendors_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendors" ADD CONSTRAINT "vendors_contract_file_id_files_id_fk" FOREIGN KEY ("contract_file_id") REFERENCES "public"."files"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_logs_wedding_idx" ON "audit_logs" USING btree ("wedding_id","created_at");--> statement-breakpoint
CREATE INDEX "campaigns_wedding_idx" ON "asoebi_campaigns" USING btree ("wedding_id");--> statement-breakpoint
CREATE INDEX "categories_wedding_idx" ON "categories" USING btree ("wedding_id");--> statement-breakpoint
CREATE UNIQUE INDEX "categories_wedding_name_uq" ON "categories" USING btree ("wedding_id","name");--> statement-breakpoint
CREATE INDEX "events_wedding_idx" ON "events" USING btree ("wedding_id");--> statement-breakpoint
CREATE INDEX "expense_payments_expense_idx" ON "expense_payments" USING btree ("expense_id");--> statement-breakpoint
CREATE INDEX "expenses_wedding_idx" ON "expenses" USING btree ("wedding_id");--> statement-breakpoint
CREATE INDEX "expenses_vendor_idx" ON "expenses" USING btree ("vendor_id");--> statement-breakpoint
CREATE INDEX "files_wedding_idx" ON "files" USING btree ("wedding_id");--> statement-breakpoint
CREATE INDEX "guests_wedding_idx" ON "guests" USING btree ("wedding_id");--> statement-breakpoint
CREATE INDEX "guests_phone_idx" ON "guests" USING btree ("wedding_id","phone");--> statement-breakpoint
CREATE INDEX "instalments_expense_idx" ON "instalments" USING btree ("expense_id");--> statement-breakpoint
CREATE INDEX "instalments_due_idx" ON "instalments" USING btree ("due_date");--> statement-breakpoint
CREATE INDEX "notification_logs_wedding_idx" ON "notification_logs" USING btree ("wedding_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "notification_logs_dedupe_uq" ON "notification_logs" USING btree ("dedupe_key");--> statement-breakpoint
CREATE INDEX "notifications_wedding_idx" ON "notifications" USING btree ("wedding_id","created_at");--> statement-breakpoint
CREATE INDEX "orders_wedding_idx" ON "asoebi_orders" USING btree ("wedding_id");--> statement-breakpoint
CREATE INDEX "orders_campaign_idx" ON "asoebi_orders" USING btree ("campaign_id");--> statement-breakpoint
CREATE INDEX "payments_order_idx" ON "payments" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "payments_wedding_idx" ON "payments" USING btree ("wedding_id");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "tasks_wedding_idx" ON "tasks" USING btree ("wedding_id");--> statement-breakpoint
CREATE INDEX "vendors_wedding_idx" ON "vendors" USING btree ("wedding_id");--> statement-breakpoint
CREATE UNIQUE INDEX "webhook_events_dedupe_uq" ON "webhook_events" USING btree ("dedupe_key");