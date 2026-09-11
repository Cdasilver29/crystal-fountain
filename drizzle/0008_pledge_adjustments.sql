-- Corrections to a pledge amount, as increment rows.
--
-- CLAUDE.md: corrections are new rows, not edits. An administrator fixing a
-- wrong amount writes the difference rather than overwriting the total, so the
-- deferred trigger from migration 0005 stays satisfied and the original
-- submissions remain readable. A correction downward needs a negative row,
-- which the old check forbade outright.
--
-- Negative is allowed only on the admin channel and only with a reason. A
-- pledger submitting through the form can never subtract: the form has no way
-- to express it, and a robot probing the endpoint should not discover one.

ALTER TABLE "pledge_increments" DROP CONSTRAINT "pledge_increments_amount_minor_check";--> statement-breakpoint
ALTER TABLE "pledge_increments" ADD COLUMN "reason" text;--> statement-breakpoint
ALTER TABLE "pledge_increments" ADD CONSTRAINT "pledge_increments_adjustment_check" CHECK ("pledge_increments"."amount_minor" > 0
          or ("pledge_increments"."channel" = 'admin'
              and "pledge_increments"."reason" is not null
              and length(trim("pledge_increments"."reason")) > 0));--> statement-breakpoint
ALTER TABLE "pledge_increments" ADD CONSTRAINT "pledge_increments_amount_minor_check" CHECK ("pledge_increments"."amount_minor" <> 0);