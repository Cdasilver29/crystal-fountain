-- Pledge accumulation by phone number, as an increment ledger.
--
-- A person now has one pledge row per campaign for as long as that pledge is
-- live. A second submission from the same phone number does not create a second
-- row: it adds to the amount on the row that is already there, and the
-- reference, the public token and the QR code all stay as they were.
--
-- CLAUDE.md says corrections are new rows, not edits, and a running total kept
-- only by UPDATE would leave no record of what it was made of. So every
-- submission also writes a pledge_increments row. A pledge amount is the sum of
-- its increments, a deferred constraint trigger holds that true at every commit,
-- and the history of how a total was reached lives in money rows rather than in
-- audit_log.
--
-- This migration refuses to apply to a database where somebody already holds
-- more than one live pledge, because the unique index at the bottom cannot be
-- built over one. That is deliberate. Merging two references into one decides
-- which of them a real person keeps, and that is a decision for whoever runs
-- the migration, not something it should do quietly on the way past.

CREATE TABLE "pledge_increments" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"pledge_id" uuid NOT NULL,
	"amount_minor" bigint NOT NULL,
	"channel" text DEFAULT 'web' NOT NULL,
	"category" text,
	"tier" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pledge_increments_amount_minor_check" CHECK ("pledge_increments"."amount_minor" > 0),
	CONSTRAINT "pledge_increments_channel_check" CHECK ("pledge_increments"."channel" in ('web','admin','event','sms','import')),
	CONSTRAINT "pledge_increments_category_check" CHECK ("pledge_increments"."category" is null or "pledge_increments"."category" in ('family','individual'))
);
--> statement-breakpoint
-- Cascading, because an increment is part of a pledge rather than a record that
-- outlives one. A pledge deleted outright leaving its parts behind would be an
-- orphan no balance could reconcile.
ALTER TABLE "pledge_increments" ADD CONSTRAINT "pledge_increments_pledge_id_pledges_id_fk" FOREIGN KEY ("pledge_id") REFERENCES "public"."pledges"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "pledge_increments_pledge_idx" ON "pledge_increments" USING btree ("pledge_id","created_at");--> statement-breakpoint
-- Every pledge that already exists became what it is in one submission, so it
-- gets exactly one increment carrying its own amount and its own timestamp.
-- This runs before the trigger is created, because until it has run every
-- existing pledge violates the invariant the trigger enforces.
insert into pledge_increments (pledge_id, amount_minor, channel, created_at)
select id, amount_minor, channel, created_at
from pledges;
--> statement-breakpoint
create or replace function assert_pledge_matches_increments()
returns trigger
language plpgsql
as $$
declare
  v_pledge_id uuid;
  v_amount    bigint;
  v_sum       bigint;
begin
  -- One function, two tables. The branches are separate statements rather than
  -- one CASE, because plpgsql parses every branch of a CASE and old.pledge_id
  -- does not exist on a pledges row.
  if tg_table_name = 'pledges' then
    if tg_op = 'DELETE' then
      v_pledge_id := old.id;
    else
      v_pledge_id := new.id;
    end if;
  else
    if tg_op = 'DELETE' then
      v_pledge_id := old.pledge_id;
    else
      v_pledge_id := new.pledge_id;
    end if;
  end if;

  select amount_minor into v_amount from pledges where id = v_pledge_id;

  -- The pledge was removed later in the same transaction. A deferred trigger
  -- still fires for the row it was queued on, and there is nothing left to hold
  -- true.
  if not found then
    return null;
  end if;

  select coalesce(sum(amount_minor), 0) into v_sum
  from pledge_increments
  where pledge_id = v_pledge_id;

  if v_sum <> v_amount then
    raise exception
      'Pledge % carries amount_minor % but its increments total % minor units',
      v_pledge_id, v_amount, v_sum
      using errcode = 'check_violation';
  end if;

  return null;
end;
$$;
--> statement-breakpoint
drop trigger if exists pledges_match_increments on pledges;--> statement-breakpoint
drop trigger if exists pledge_increments_match_pledge on pledge_increments;--> statement-breakpoint
-- Deferred, because the invariant is a property of a finished transaction and
-- not of a single statement. Recording a pledge inserts the pledge and then the
-- increment, and for the instant between those two statements the sum does not
-- match. What must never be true is that a committed transaction leaves them
-- disagreeing, and that is exactly what initially deferred checks.
create constraint trigger pledges_match_increments
after insert or update of amount_minor on pledges
deferrable initially deferred
for each row
execute function assert_pledge_matches_increments();
--> statement-breakpoint
create constraint trigger pledge_increments_match_pledge
after insert or update or delete on pledge_increments
deferrable initially deferred
for each row
execute function assert_pledge_matches_increments();
--> statement-breakpoint
-- One live pledge per person per campaign, enforced by the database.
--
-- Accumulation reads the existing pledge and then writes to it. Two submissions
-- arriving together could both read nothing and both insert, and the result
-- would be one person holding two references, which is the whole thing this
-- change exists to prevent. The predicate matches the status filter the service
-- selects on exactly: a fulfilled, cancelled or void pledge is finished and does
-- not block a fresh one.
CREATE UNIQUE INDEX "pledges_one_live_per_pledger_idx" ON "pledges" USING btree ("campaign_id","pledger_id") WHERE status in ('pending','verified');--> statement-breakpoint
-- Semi annual redemption, for the plan dropdown on the details step.
ALTER TABLE "pledges" DROP CONSTRAINT "pledges_installment_frequency_check";--> statement-breakpoint
ALTER TABLE "pledges" ADD CONSTRAINT "pledges_installment_frequency_check" CHECK ("pledges"."installment_frequency" in ('monthly','quarterly','semi_annually','annually'));
