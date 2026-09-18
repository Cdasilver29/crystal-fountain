CREATE TABLE "pledge_change_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pledge_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"requested_amount_minor" bigint,
	"requested_frequency" text,
	"requested_name" text,
	"payment_reference" text,
	"payment_amount_minor" bigint,
	"payment_paid_on" date,
	"reason" text NOT NULL,
	"contact_phone_e164" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"decision_note" text,
	"source_ip" "inet",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pledge_change_requests_kind_check" CHECK ("pledge_change_requests"."kind" in ('reduce_amount','change_plan','correct_name','payment_missing','cancel_pledge')),
	CONSTRAINT "pledge_change_requests_status_check" CHECK ("pledge_change_requests"."status" in ('pending','approved','declined','closed')),
	CONSTRAINT "pledge_change_requests_reason_check" CHECK (length(trim("pledge_change_requests"."reason")) >= 10),
	CONSTRAINT "pledge_change_requests_frequency_check" CHECK ("pledge_change_requests"."requested_frequency" is null
          or "pledge_change_requests"."requested_frequency" in ('one_off','monthly','quarterly','semi_annually','annually')),
	CONSTRAINT "pledge_change_requests_amounts_check" CHECK (("pledge_change_requests"."requested_amount_minor" is null or "pledge_change_requests"."requested_amount_minor" > 0)
          and ("pledge_change_requests"."payment_amount_minor" is null or "pledge_change_requests"."payment_amount_minor" > 0)),
	CONSTRAINT "pledge_change_requests_reduce_amount_check" CHECK ("pledge_change_requests"."kind" <> 'reduce_amount'
          or ("pledge_change_requests"."requested_amount_minor" is not null
              and "pledge_change_requests"."requested_frequency" is null
              and "pledge_change_requests"."requested_name" is null
              and "pledge_change_requests"."payment_reference" is null
              and "pledge_change_requests"."payment_amount_minor" is null
              and "pledge_change_requests"."payment_paid_on" is null)),
	CONSTRAINT "pledge_change_requests_change_plan_check" CHECK ("pledge_change_requests"."kind" <> 'change_plan'
          or ("pledge_change_requests"."requested_frequency" is not null
              and "pledge_change_requests"."requested_amount_minor" is null
              and "pledge_change_requests"."requested_name" is null
              and "pledge_change_requests"."payment_reference" is null
              and "pledge_change_requests"."payment_amount_minor" is null
              and "pledge_change_requests"."payment_paid_on" is null)),
	CONSTRAINT "pledge_change_requests_correct_name_check" CHECK ("pledge_change_requests"."kind" <> 'correct_name'
          or ("pledge_change_requests"."requested_name" is not null
              and length(trim("pledge_change_requests"."requested_name")) >= 2
              and "pledge_change_requests"."requested_amount_minor" is null
              and "pledge_change_requests"."requested_frequency" is null
              and "pledge_change_requests"."payment_reference" is null
              and "pledge_change_requests"."payment_amount_minor" is null
              and "pledge_change_requests"."payment_paid_on" is null)),
	CONSTRAINT "pledge_change_requests_payment_missing_check" CHECK ("pledge_change_requests"."kind" <> 'payment_missing'
          or ("pledge_change_requests"."payment_reference" is not null
              and length(trim("pledge_change_requests"."payment_reference")) > 0
              and "pledge_change_requests"."payment_amount_minor" is not null
              and "pledge_change_requests"."payment_paid_on" is not null
              and "pledge_change_requests"."requested_amount_minor" is null
              and "pledge_change_requests"."requested_frequency" is null
              and "pledge_change_requests"."requested_name" is null)),
	CONSTRAINT "pledge_change_requests_cancel_pledge_check" CHECK ("pledge_change_requests"."kind" <> 'cancel_pledge'
          or ("pledge_change_requests"."requested_amount_minor" is null
              and "pledge_change_requests"."requested_frequency" is null
              and "pledge_change_requests"."requested_name" is null
              and "pledge_change_requests"."payment_reference" is null
              and "pledge_change_requests"."payment_amount_minor" is null
              and "pledge_change_requests"."payment_paid_on" is null)),
	CONSTRAINT "pledge_change_requests_decision_check" CHECK (case "pledge_change_requests"."status"
            when 'pending' then "pledge_change_requests"."decided_at" is null and "pledge_change_requests"."decided_by" is null
            when 'closed' then "pledge_change_requests"."decided_at" is not null
            else "pledge_change_requests"."decided_at" is not null and "pledge_change_requests"."decided_by" is not null
          end)
);
--> statement-breakpoint
ALTER TABLE "pledge_change_requests" ADD CONSTRAINT "pledge_change_requests_pledge_id_pledges_id_fk" FOREIGN KEY ("pledge_id") REFERENCES "public"."pledges"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pledge_change_requests" ADD CONSTRAINT "pledge_change_requests_decided_by_admin_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."admin_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "pledge_change_requests_one_pending_idx" ON "pledge_change_requests" USING btree ("pledge_id") WHERE status = 'pending';--> statement-breakpoint
CREATE INDEX "pledge_change_requests_status_created_idx" ON "pledge_change_requests" USING btree ("status","created_at" DESC NULLS LAST);