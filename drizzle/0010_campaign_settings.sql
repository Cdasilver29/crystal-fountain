-- Campaign settings the super administrator can change without a deploy.
--
-- The target, the opening balance and the auto approve limit move for ordinary
-- reasons and should not need a code release. So do the paybill and the bank
-- details, and those are the riskiest values in the whole system: one mistyped
-- digit sends the congregation's money to the wrong account. Every change here
-- is an audited write by one named person, which is the trade being made for
-- not having to deploy.
--
-- Every column is nullable, so an installation that has filled none of them in
-- falls back to src/content/campaign.ts and nothing changes.

ALTER TABLE "campaigns" ADD COLUMN "auto_approve_limit_minor" bigint;--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "mpesa_paybill" text;--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "mpesa_account_name" text;--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "bank_name" text;--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "bank_branch" text;--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "bank_account_name" text;--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "bank_account" text;--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "bank_swift" text;--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "bank_branch_code" text;--> statement-breakpoint
-- An opening balance is money already raised. It can be nothing, but it cannot
-- be less than nothing, and a negative one would quietly subtract from the
-- figure the congregation is watching.
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_opening_balance_check" CHECK ("campaigns"."opening_balance_minor" >= 0);--> statement-breakpoint
-- Null means fall back to PLEDGE_AUTO_APPROVE_LIMIT_KES. Zero would mean every
-- pledge waits for the treasurer, which is a reasonable thing to want but not a
-- thing to arrive at by leaving a box empty.
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_auto_approve_limit_check" CHECK ("campaigns"."auto_approve_limit_minor" is null or "campaigns"."auto_approve_limit_minor" > 0);
