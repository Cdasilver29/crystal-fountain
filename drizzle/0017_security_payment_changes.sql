CREATE TABLE "payment_detail_changes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"current" jsonb NOT NULL,
	"proposed" jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"requested_by" uuid NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone DEFAULT now() + interval '7 days' NOT NULL,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	CONSTRAINT "payment_detail_changes_status_check" CHECK ("payment_detail_changes"."status" in ('pending','approved','rejected','expired')),
	CONSTRAINT "payment_detail_changes_decided_check" CHECK (("payment_detail_changes"."status" = 'pending') = ("payment_detail_changes"."decided_at" is null)
          and ("payment_detail_changes"."status" not in ('approved','rejected') or "payment_detail_changes"."decided_by" is not null)),
	CONSTRAINT "payment_detail_changes_not_self_approved_check" CHECK ("payment_detail_changes"."status" <> 'approved' or "payment_detail_changes"."decided_by" <> "payment_detail_changes"."requested_by")
);
--> statement-breakpoint
CREATE TABLE "pledge_submissions" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"ip" "inet",
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "payment_detail_changes" ADD CONSTRAINT "payment_detail_changes_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_detail_changes" ADD CONSTRAINT "payment_detail_changes_requested_by_admin_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."admin_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_detail_changes" ADD CONSTRAINT "payment_detail_changes_decided_by_admin_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."admin_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "payment_detail_changes_one_pending_idx" ON "payment_detail_changes" USING btree ("campaign_id") WHERE status = 'pending';--> statement-breakpoint
CREATE INDEX "pledge_submissions_ip_at_idx" ON "pledge_submissions" USING btree ("ip","at");