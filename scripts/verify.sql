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
