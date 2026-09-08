-- Extensions required by the schema.
--   pgcrypto  gen_random_uuid() for every primary key
--   citext    case insensitive email on pledgers and admin_users
create extension if not exists pgcrypto;
--> statement-breakpoint
create extension if not exists citext;
--> statement-breakpoint
-- Source of the human reference, CF26-000124, max 12 characters.
--
-- A sequence is the concurrency safe way to do this. nextval() takes no lock and
-- never hands the same value to two transactions, so two simultaneous pledge
-- inserts cannot collide. Values are consumed on rollback, which leaves gaps.
-- Gaps are fine: the reference is an identifier, not a count.
create sequence if not exists pledge_ref_seq
  as bigint
  start with 1
  increment by 1
  minvalue 1
  maxvalue 999999
  no cycle;
--> statement-breakpoint
-- Formats the next reference. Kept in the database so the value is produced in
-- the same statement as the insert, with no read then write window in
-- application code.
create or replace function next_pledge_reference()
returns text
language sql
volatile
as $$
  select 'CF26-' || lpad(nextval('pledge_ref_seq')::text, 6, '0');
$$;
