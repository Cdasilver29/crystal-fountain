ALTER TABLE "payment_allocations" ADD COLUMN "reversed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "payment_allocations" ADD COLUMN "reversed_by" uuid;--> statement-breakpoint
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_reversed_by_admin_users_id_fk" FOREIGN KEY ("reversed_by") REFERENCES "public"."admin_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "alloc_payment_idx" ON "payment_allocations" USING btree ("payment_id");--> statement-breakpoint
-- A reversed allocation is invisible to every balance.
--
-- CLAUDE.md: corrections are new rows, not edits. Un-matching a payment from a
-- pledge sets reversed_at rather than deleting the row, so the ledger keeps
-- both the allocation and the correction. That only works if the derived
-- figures ignore a reversed row, which is what these two statements do.
--
-- The column list is unchanged, so create or replace is enough.
create or replace view v_pledge_balances as
select p.id as pledge_id,
       p.amount_minor,
       coalesce(sum(a.amount_minor), 0) as paid_minor,
       p.amount_minor - coalesce(sum(a.amount_minor), 0) as outstanding_minor
from pledges p
left join payment_allocations a
       on a.pledge_id = p.id
      and a.reversed_at is null
group by p.id;
--> statement-breakpoint
-- The over allocation guard, counting live allocations only.
--
-- Without the reversed_at filter a reversal would leave the payment looking
-- fully committed for ever, and the freed amount could never be matched to the
-- pledge it actually belongs to.
create or replace function assert_allocation_within_payment()
returns trigger
language plpgsql
as $$
declare
  v_payment_id     uuid;
  v_payment_amount bigint;
  v_allocated      bigint;
begin
  v_payment_id := coalesce(new.payment_id, old.payment_id);

  -- Lock the parent payment so two concurrent allocations cannot each read a
  -- stale total and both pass the check.
  select amount_minor into v_payment_amount
  from payments
  where id = v_payment_id
  for update;

  select coalesce(sum(amount_minor), 0) into v_allocated
  from payment_allocations
  where payment_id = v_payment_id
    and reversed_at is null;

  if v_allocated > v_payment_amount then
    raise exception
      'Allocations for payment % total % minor units, which exceeds the payment amount of % minor units',
      v_payment_id, v_allocated, v_payment_amount
      using errcode = 'check_violation';
  end if;

  return null;
end;
$$;
