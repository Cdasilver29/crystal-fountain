CREATE TABLE "email_sends" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"recipient_hash" text NOT NULL,
	"kind" text NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "email_sends_recipient_kind_at_idx" ON "email_sends" USING btree ("recipient_hash","kind","at");--> statement-breakpoint
CREATE INDEX "email_sends_at_idx" ON "email_sends" USING btree ("at");