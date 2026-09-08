CREATE TYPE "public"."pledge_status" AS ENUM('pending', 'verified', 'fulfilled', 'cancelled', 'void');--> statement-breakpoint
CREATE TABLE "admin_users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" "citext" NOT NULL,
	"full_name" text NOT NULL,
	"role" text NOT NULL,
	"totp_secret" "bytea",
	"is_active" boolean DEFAULT true NOT NULL,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "admin_users_email_unique" UNIQUE("email"),
	CONSTRAINT "admin_users_role_check" CHECK ("admin_users"."role" in ('viewer','treasurer','admin'))
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor_type" text NOT NULL,
	"actor_id" uuid,
	"action" text NOT NULL,
	"entity" text NOT NULL,
	"entity_id" uuid,
	"before" jsonb,
	"after" jsonb,
	"ip" "inet",
	"user_agent" text,
	CONSTRAINT "audit_log_actor_type_check" CHECK ("audit_log"."actor_type" in ('public','admin','system','webhook'))
);
--> statement-breakpoint
CREATE TABLE "campaign_daily_stats" (
	"campaign_id" uuid NOT NULL,
	"stat_date" date NOT NULL,
	"pledged_minor" bigint NOT NULL,
	"received_minor" bigint NOT NULL,
	"pledge_count" integer NOT NULL,
	"pledger_count" integer NOT NULL,
	"new_pledges" integer NOT NULL,
	"new_pledged_minor" bigint NOT NULL,
	CONSTRAINT "campaign_daily_stats_pkey" PRIMARY KEY("campaign_id","stat_date")
);
--> statement-breakpoint
CREATE TABLE "campaigns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"target_minor" bigint NOT NULL,
	"currency" char(3) DEFAULT 'KES' NOT NULL,
	"opening_balance_minor" bigint DEFAULT 0 NOT NULL,
	"starts_on" date NOT NULL,
	"target_date" date,
	"is_public" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "campaigns_slug_unique" UNIQUE("slug"),
	CONSTRAINT "campaigns_target_minor_check" CHECK ("campaigns"."target_minor" > 0)
);
--> statement-breakpoint
CREATE TABLE "payment_allocations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"payment_id" uuid NOT NULL,
	"pledge_id" uuid NOT NULL,
	"amount_minor" bigint NOT NULL,
	"allocated_by" uuid,
	"allocated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"note" text,
	CONSTRAINT "payment_allocations_amount_minor_check" CHECK ("payment_allocations"."amount_minor" > 0)
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"method" text NOT NULL,
	"external_ref" text,
	"amount_minor" bigint NOT NULL,
	"currency" char(3) DEFAULT 'KES' NOT NULL,
	"paid_at" timestamp with time zone NOT NULL,
	"payer_name_raw" text,
	"payer_msisdn" text,
	"account_ref_raw" text,
	"status" text DEFAULT 'received' NOT NULL,
	"recorded_by" uuid,
	"raw_payload" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payments_amount_minor_check" CHECK ("payments"."amount_minor" > 0),
	CONSTRAINT "payments_method_check" CHECK ("payments"."method" in ('mpesa','bank','cash','cheque','card','other')),
	CONSTRAINT "payments_status_check" CHECK ("payments"."status" in ('received','reversed','disputed'))
);
--> statement-breakpoint
CREATE TABLE "pledgers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"phone_e164" text NOT NULL,
	"phone_verified_at" timestamp with time zone,
	"full_name" text NOT NULL,
	"email" "citext",
	"membership_no" text,
	"is_member" boolean,
	"id_type" text,
	"id_ciphertext" "bytea",
	"id_hash" "bytea",
	"display_name" text,
	"display_consent" boolean DEFAULT false NOT NULL,
	"contact_consent" boolean DEFAULT false NOT NULL,
	"privacy_version" text NOT NULL,
	"consented_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pledgers_phone_e164_unique" UNIQUE("phone_e164"),
	CONSTRAINT "pledgers_id_type_check" CHECK ("pledgers"."id_type" in ('national_id','passport','alien_id'))
);
--> statement-breakpoint
CREATE TABLE "pledges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"pledger_id" uuid NOT NULL,
	"reference" text NOT NULL,
	"public_token" text NOT NULL,
	"amount_minor" bigint NOT NULL,
	"currency" char(3) DEFAULT 'KES' NOT NULL,
	"status" "pledge_status" DEFAULT 'pending' NOT NULL,
	"intent" text DEFAULT 'one_off' NOT NULL,
	"installment_amount_minor" bigint,
	"installment_frequency" text,
	"target_completion_on" date,
	"channel" text DEFAULT 'web' NOT NULL,
	"note" text,
	"verified_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pledges_reference_unique" UNIQUE("reference"),
	CONSTRAINT "pledges_public_token_unique" UNIQUE("public_token"),
	CONSTRAINT "pledges_amount_minor_check" CHECK ("pledges"."amount_minor" > 0),
	CONSTRAINT "pledges_installment_amount_minor_check" CHECK ("pledges"."installment_amount_minor" > 0),
	CONSTRAINT "pledges_intent_check" CHECK ("pledges"."intent" in ('one_off','installment')),
	CONSTRAINT "pledges_installment_frequency_check" CHECK ("pledges"."installment_frequency" in ('monthly','quarterly','annually')),
	CONSTRAINT "pledges_channel_check" CHECK ("pledges"."channel" in ('web','admin','event','sms','import'))
);
--> statement-breakpoint
ALTER TABLE "campaign_daily_stats" ADD CONSTRAINT "campaign_daily_stats_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_pledge_id_pledges_id_fk" FOREIGN KEY ("pledge_id") REFERENCES "public"."pledges"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_allocated_by_admin_users_id_fk" FOREIGN KEY ("allocated_by") REFERENCES "public"."admin_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_recorded_by_admin_users_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."admin_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pledges" ADD CONSTRAINT "pledges_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pledges" ADD CONSTRAINT "pledges_pledger_id_pledgers_id_fk" FOREIGN KEY ("pledger_id") REFERENCES "public"."pledgers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "alloc_pledge_idx" ON "payment_allocations" USING btree ("pledge_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payments_channel_ref_uq" ON "payments" USING btree ("method","external_ref") WHERE "payments"."external_ref" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "pledgers_id_hash_uq" ON "pledgers" USING btree ("id_hash") WHERE "pledgers"."id_hash" is not null;--> statement-breakpoint
CREATE INDEX "pledges_campaign_status_idx" ON "pledges" USING btree ("campaign_id","status");--> statement-breakpoint
CREATE INDEX "pledges_created_idx" ON "pledges" USING btree ("created_at" DESC NULLS LAST);