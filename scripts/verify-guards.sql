-- Proves the money guards actually fire. Run with:
--   pnpm db:verify:guards
--
-- Everything this creates is removed again at the end. The one row it leaves
-- behind is an audit_log row, because audit_log is append only by design and
-- refusing to delete it is exactly the behaviour under test.

\echo '== guard tests =='
do $$
declare
  v_campaign  uuid;
  v_pledger   uuid;
  v_pledge    uuid;
  v_payment   uuid;
  v_audit_id  bigint;
  v_reference text;
  v_fired     boolean;
begin
  select id into v_campaign from campaigns where slug = 'crystal-fountain';
  if v_campaign is null then
    raise exception 'GUARD TEST SETUP FAILED: seed the campaign first';
  end if;

  -- 1. next_pledge_reference() produces CF26-NNNNNN within 12 characters.
  v_reference := next_pledge_reference();
  if v_reference !~ '^CF26-[0-9]{6}$' then
    raise exception 'GUARD 1 FAILED: reference % does not match CF26-NNNNNN', v_reference;
  end if;
  if length(v_reference) > 12 then
    raise exception 'GUARD 1 FAILED: reference % is % characters, over the 12 cap',
      v_reference, length(v_reference);
  end if;

  insert into pledgers (phone_e164, full_name, privacy_version, consented_at)
  values ('+254700000000', 'Guard Test', 'test', now())
  returning id into v_pledger;

  insert into pledges (campaign_id, pledger_id, reference, public_token, amount_minor)
  values (v_campaign, v_pledger, v_reference, 'guardtesttoken00000000', 100000)
  returning id into v_pledge;

  insert into payments (campaign_id, method, amount_minor, paid_at)
  values (v_campaign, 'cash', 100000, now())
  returning id into v_payment;

  -- 2. An allocation within the payment amount is accepted.
  insert into payment_allocations (payment_id, pledge_id, amount_minor)
  values (v_payment, v_pledge, 60000);

  -- 3. An allocation that takes the total over the payment amount is rejected.
  v_fired := false;
  begin
    insert into payment_allocations (payment_id, pledge_id, amount_minor)
    values (v_payment, v_pledge, 60000);
  exception when check_violation then
    v_fired := true;
  end;
  if not v_fired then
    raise exception 'GUARD 3 FAILED: over allocation was accepted';
  end if;

  -- 4. A negative or zero allocation is rejected by the check constraint.
  v_fired := false;
  begin
    insert into payment_allocations (payment_id, pledge_id, amount_minor)
    values (v_payment, v_pledge, 0);
  exception when check_violation then
    v_fired := true;
  end;
  if not v_fired then
    raise exception 'GUARD 4 FAILED: a zero amount allocation was accepted';
  end if;

  insert into audit_log (actor_type, action, entity, entity_id)
  values ('system', 'guard.test', 'pledge', v_pledge)
  returning id into v_audit_id;

  -- 5. audit_log rejects update.
  v_fired := false;
  begin
    update audit_log set action = 'tampered' where id = v_audit_id;
  exception when insufficient_privilege then
    v_fired := true;
  end;
  if not v_fired then
    raise exception 'GUARD 5 FAILED: audit_log accepted an update';
  end if;

  -- 6. audit_log rejects delete.
  v_fired := false;
  begin
    delete from audit_log where id = v_audit_id;
  exception when insufficient_privilege then
    v_fired := true;
  end;
  if not v_fired then
    raise exception 'GUARD 6 FAILED: audit_log accepted a delete';
  end if;

  -- Clean up everything except the audit row, which by design cannot go.
  delete from payment_allocations where payment_id = v_payment;
  delete from payments where id = v_payment;
  delete from pledges where id = v_pledge;
  delete from pledgers where id = v_pledger;
end
$$;

\echo ''
\echo '== result =='
select 'all 6 guards passed' as result;
