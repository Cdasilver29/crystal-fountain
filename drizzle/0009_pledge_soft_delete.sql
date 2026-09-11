-- Removing a pledge without destroying it.
--
-- The row never goes. It is a financial record, every audit entry about it
-- points at it, and its increments and any payment allocations hang off it.
-- Setting deleted_at takes it out of every total, every list and every export,
-- which is the whole of what deleting was meant to achieve, while leaving the
-- evidence that it once existed.
--
-- Most of the exclusion happens here, in the two views, because almost
-- everything that reads a figure reads it through one of them. The direct
-- queries in the services carry the filter themselves.

ALTER TABLE "pledges" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
-- A removed pledge stops holding its person's place.
--
-- Without this a deleted pledge would keep the partial unique index occupied
-- and that pledger could never record another one: the accumulation query would
-- not find the deleted row, try to insert, and be refused by an index still
-- counting it. See migration 0005 for the index this replaces.
DROP INDEX "pledges_one_live_per_pledger_idx";--> statement-breakpoint
CREATE UNIQUE INDEX "pledges_one_live_per_pledger_idx" ON "pledges" USING btree ("campaign_id","pledger_id") WHERE status in ('pending','verified') and deleted_at is null;--> statement-breakpoint
-- A removed pledge has no balance.
--
-- Dropped and recreated rather than replaced, because the column list is the
-- same but leaving a removed pledge in here would keep it appearing in the
-- allocation screens, which read balances rather than pledges.
create or replace view v_pledge_balances as
select p.id as pledge_id,
       p.amount_minor,
       coalesce(sum(a.amount_minor), 0) as paid_minor,
       p.amount_minor - coalesce(sum(a.amount_minor), 0) as outstanding_minor
from pledges p
left join payment_allocations a
       on a.pledge_id = p.id
      and a.reversed_at is null
where p.deleted_at is null
group by p.id;
--> statement-breakpoint
-- And it counts toward nothing the congregation can see.
--
-- All four figures, not merely the money: a removed pledge must not be in the
-- pledge count or the pledger count either, or the home page would say twelve
-- people have pledged a sum that only eleven of them add up to.
create or replace view v_campaign_totals as
select c.id as campaign_id,
       c.target_minor,
       c.opening_balance_minor
         + coalesce((select sum(amount_minor) from pledges
                     where campaign_id = c.id
                       and status in ('verified','fulfilled')
                       and deleted_at is null), 0)
         as pledged_minor,
       c.opening_balance_minor
         + coalesce((select sum(amount_minor) from payments
                     where campaign_id = c.id and status = 'received'), 0)
         as received_minor,
       (select count(*) from pledges
        where campaign_id = c.id
          and status in ('verified','fulfilled')
          and deleted_at is null) as pledge_count,
       (select count(distinct pledger_id) from pledges
        where campaign_id = c.id
          and status in ('verified','fulfilled')
          and deleted_at is null) as pledger_count
from campaigns c;
--> statement-breakpoint
-- Reading a removed pledge back is cheap and happens on every list, so the
-- filter gets an index rather than a sequential scan of the table.
create index if not exists pledges_live_idx
  on pledges (campaign_id, status)
  where deleted_at is null;
