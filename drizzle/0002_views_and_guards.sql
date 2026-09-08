-- Derived views, PLAN.md section 4. Totals are always read from here, never
-- from a counter column and never from config.

create or replace view v_pledge_balances as
select p.id as pledge_id,
       p.amount_minor,
       coalesce(sum(a.amount_minor), 0) as paid_minor,
       p.amount_minor - coalesce(sum(a.amount_minor), 0) as outstanding_minor
from pledges p
left join payment_allocations a on a.pledge_id = p.id
group by p.id;
--> statement-breakpoint
create or replace view v_campaign_totals as
select c.id as campaign_id,
       c.target_minor,
       c.opening_balance_minor
         + coalesce((select sum(amount_minor) from pledges
                     where campaign_id = c.id and status in ('verified','fulfilled')), 0)
         as pledged_minor,
       c.opening_balance_minor
         + coalesce((select sum(amount_minor) from payments
                     where campaign_id = c.id and status = 'received'), 0)
         as received_minor,
       (select count(*) from pledges
        where campaign_id = c.id and status in ('verified','fulfilled')) as pledge_count,
       (select count(distinct pledger_id) from pledges
        where campaign_id = c.id and status in ('verified','fulfilled')) as pledger_count
from campaigns c;
--> statement-breakpoint
-- Over allocation guard. A payment can be split across many pledges, but the
-- allocations must never sum to more than the payment itself.
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
  where payment_id = v_payment_id;

  if v_allocated > v_payment_amount then
    raise exception
      'Allocations for payment % total % minor units, which exceeds the payment amount of % minor units',
      v_payment_id, v_allocated, v_payment_amount
      using errcode = 'check_violation';
  end if;

  return null;
end;
$$;
--> statement-breakpoint
drop trigger if exists payment_allocations_within_payment on payment_allocations;
--> statement-breakpoint
-- AFTER so the row being inserted is already visible to the sum above.
create trigger payment_allocations_within_payment
after insert or update on payment_allocations
for each row
execute function assert_allocation_within_payment();
--> statement-breakpoint
-- audit_log is append only.
--
-- The revoke below is defence in depth and nothing more. On Neon the app
-- connects as the role that owns the table, and an owner keeps implicit rights
-- that a revoke cannot remove. The triggers are what actually enforce this.
-- A separate lower privilege application role is the proper fix and belongs
-- with real admin auth.
create or replace function audit_log_is_append_only()
returns trigger
language plpgsql
as $$
begin
  raise exception 'audit_log is append only, % is not permitted', tg_op
    using errcode = 'insufficient_privilege';
end;
$$;
--> statement-breakpoint
drop trigger if exists audit_log_no_update on audit_log;
--> statement-breakpoint
create trigger audit_log_no_update
before update on audit_log
for each row
execute function audit_log_is_append_only();
--> statement-breakpoint
drop trigger if exists audit_log_no_delete on audit_log;
--> statement-breakpoint
create trigger audit_log_no_delete
before delete on audit_log
for each row
execute function audit_log_is_append_only();
--> statement-breakpoint
revoke update, delete on audit_log from public;
--> statement-breakpoint
do $$
begin
  execute format('revoke update, delete on public.audit_log from %I', current_user);
end
$$;
