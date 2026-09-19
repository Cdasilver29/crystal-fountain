-- Crystal Fountain verification queries.
-- Run with:  psql "$DATABASE_URL" -f scripts/verify.sql
--
-- Totals are read from the views, never from a counter column, never from
-- config. Amounts below are minor units (cents) alongside their KES value.

\echo '== 1. schema objects present =='
select table_name, table_type
from information_schema.tables
where table_schema = 'public'
order by table_type, table_name;

\echo ''
\echo '== 2. seeded campaign =='
select slug,
       name,
       target_minor,
       (target_minor / 100)::bigint as target_kes,
       opening_balance_minor,
       currency,
       starts_on::text as starts_on,
       is_public
from campaigns
order by slug;

\echo ''
\echo '== 3. v_campaign_totals =='
select c.slug,
       t.target_minor,
       t.pledged_minor,
       t.received_minor,
       t.target_minor - t.pledged_minor as remaining_minor,
       t.pledge_count,
       t.pledger_count,
       (round(t.pledged_minor  * 10000.0 / t.target_minor) / 100)::numeric(7,2) as percent_pledged,
       (round(t.received_minor * 10000.0 / t.target_minor) / 100)::numeric(7,2) as percent_received
from v_campaign_totals t
join campaigns c on c.id = t.campaign_id
order by c.slug;

\echo ''
\echo '== 4. v_pledge_balances =='
select b.pledge_id,
       p.reference,
       p.status,
       b.amount_minor,
       b.paid_minor,
       b.outstanding_minor
from v_pledge_balances b
join pledges p on p.id = b.pledge_id
order by p.reference;

\echo ''
\echo '== 5. reference sequence =='
select last_value, is_called from pledge_ref_seq;

\echo ''
\echo '== 6. guards installed =='
select c.relname as table_name, t.tgname as trigger_name
from pg_trigger t
join pg_class c on c.oid = t.tgrelid
where not t.tgisinternal
order by c.relname, t.tgname;

\echo ''
\echo '== 7. the invariants, as one line =='
-- Everything above is a table for a person to read. This is the same three
-- facts reduced to a verdict, so the sweep that runs every suite can tell a
-- pass from a failure without somebody reading the tables by eye.
with balances as (
  select count(*)::int as broken
  from pledges p
  join (
    select pledge_id, sum(amount_minor) as increment_sum
    from pledge_increments
    group by pledge_id
  ) i on i.pledge_id = p.id
  where p.amount_minor <> i.increment_sum
),
orphans as (
  -- A pledge with no increments at all is the other way the ledger can be
  -- wrong, and the join above cannot see it.
  select count(*)::int as broken
  from pledges p
  where not exists (select 1 from pledge_increments i where i.pledge_id = p.id)
),
sequence_state as (
  -- The sequence must never re-issue a reference that already exists. It sits
  -- ahead of the rows whenever a run has consumed numbers without keeping the
  -- pledge, which is ordinary; behind them is the state that collides.
  select (select last_value from pledge_ref_seq) as last_value,
         coalesce(max(substring(reference from 'CF26-(\d+)')::bigint), 0) as highest
  from pledges
),
guards as (
  select count(*)::int as installed
  from pg_trigger t
  join pg_class c on c.oid = t.tgrelid
  where not t.tgisinternal
    and t.tgname in (
      'audit_log_no_delete',
      'audit_log_no_update',
      'payment_allocations_within_payment',
      'pledge_increments_match_pledge',
      'pledges_match_increments'
    )
)
select case
         when b.broken = 0
          and o.broken = 0
          and s.last_value >= s.highest
          and g.installed = 5
         then 'all checks passed'
         else 'FAILED: '
              || case when b.broken > 0
                      then b.broken || ' pledge(s) disagree with their increments; ' else '' end
              || case when o.broken > 0
                      then o.broken || ' pledge(s) have no increments; ' else '' end
              || case when s.last_value < s.highest
                      then 'sequence at ' || s.last_value || ' is below reference '
                           || s.highest || '; ' else '' end
              || case when g.installed <> 5
                      then g.installed || ' of 5 guards installed' else '' end
       end as result
from balances b, orphans o, sequence_state s, guards g;
