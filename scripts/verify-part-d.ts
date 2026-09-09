import { config } from "dotenv";

// Load the environment before anything imports src/env.ts.
config({ path: ".env.local" });

/**
 * Allocation verification. Exercises payments.allocate and payments.deallocate
 * against the real database and reads every result back out of
 * v_pledge_balances and v_campaign_totals with SQL, not application logs.
 *
 * Usage: pnpm db:verify:allocations
 *
 * Everything it creates is removed at the end, apart from audit_log rows, which
 * are append only by design.
 */

const CAMPAIGN_SLUG = "crystal-fountain";
const TEST_PHONE = "0799922222";
const TEST_PHONE_PREFIX = "+2547999";

function heading(text: string) {
  console.log(`\n== ${text} ==`);
}

function show(rows: Record<string, unknown>[]) {
  if (rows.length === 0) {
    console.log("(0 rows)");
    return;
  }
  console.table(
    rows.map((row) =>
      Object.fromEntries(
        Object.entries(row).map(([k, v]) => [k, v === null ? null : String(v)]),
      ),
    ),
  );
}

async function main() {
  const { db } = await import("@/db");
  const { sql } = await import("drizzle-orm");
  const pledges = await import("@/server/services/pledges");
  const payments = await import("@/server/services/payments");
  const campaign = await import("@/server/services/campaign");
  const { createPledgeInput } = await import("@/server/contracts/pledges");
  const { recordPaymentInput } = await import("@/server/contracts/payments");
  const { isServiceError } = await import("@/server/errors");

  const failures: string[] = [];
  const check = (label: string, ok: boolean, detail?: string) => {
    if (!ok) failures.push(label);
    console.log(`${ok ? "pass" : "FAIL"}  ${label}${detail ? `  ${detail}` : ""}`);
  };

  /** The pledge as v_pledge_balances reports it. The figures come from there. */
  const balances = async (pledgeId: string) => {
    const result = await db.execute(sql`
      select p.reference,
             p.status,
             b.amount_minor,
             b.paid_minor,
             b.outstanding_minor
      from v_pledge_balances b
      join pledges p on p.id = b.pledge_id
      where b.pledge_id = ${pledgeId}
    `);
    return result.rows as Record<string, unknown>[];
  };

  const balanceOf = async (pledgeId: string) => {
    const [row] = await balances(pledgeId);
    return {
      status: String(row.status),
      paidMinor: BigInt(String(row.paid_minor)),
      outstandingMinor: BigInt(String(row.outstanding_minor)),
    };
  };

  /**
   * An admin to attribute the writes to. payment_allocations.allocated_by is a
   * foreign key, so this cannot be a made up uuid.
   */
  heading("0. actor");
  const [existingAdmin] = (
    await db.execute(sql`
      select id, email, role from admin_users where is_active order by created_at limit 1
    `)
  ).rows as { id: string; email: string; role: string }[];

  let temporaryAdminId: string | null = null;

  if (!existingAdmin) {
    const inserted = await db.execute(sql`
      insert into admin_users (email, full_name, role)
      values ('verify-part-d@example.test', 'Verification Treasurer', 'treasurer')
      returning id
    `);
    temporaryAdminId = String(
      (inserted.rows as { id: string }[])[0].id,
    );
  }

  const adminId = existingAdmin?.id ?? temporaryAdminId!;
  show([
    {
      adminId,
      email: existingAdmin?.email ?? "verify-part-d@example.test",
      role: existingAdmin?.role ?? "treasurer",
      created: temporaryAdminId !== null,
    },
  ]);

  // 1. A verified pledge to allocate against
  heading("1. a verified pledge of KES 25,000");
  const created = await pledges.create(db, {
    input: createPledgeInput.parse({
      fullName: "Allocation Verification",
      phone: TEST_PHONE,
      amountKes: 25_000,
      intent: "one_off",
      recordConsent: true,
      contactConsent: false,
      displayConsent: false,
    }),
    campaignSlug: CAMPAIGN_SLUG,
    request: { ip: "203.0.113.20", userAgent: "verify-part-d" },
  });

  await pledges.approve(db, { pledgeId: created.pledgeId, adminId });

  const pledgeId = created.pledgeId;
  show(await balances(pledgeId));
  const opening = await balanceOf(pledgeId);
  check("pledge is verified", opening.status === "verified");
  check("paid_minor starts at 0", opening.paidMinor === 0n);
  check(
    "outstanding_minor starts at the full 2500000",
    opening.outstandingMinor === 2_500_000n,
  );

  // 2. Two payments, recorded but not yet matched to anything
  heading("2. two payments recorded");
  const today = new Date().toISOString().slice(0, 10);

  const paymentA = await payments.record(db, {
    input: recordPaymentInput.parse({
      method: "cash",
      externalRef: "",
      amountKes: 10_000,
      payerName: "Allocation Verification",
      payerPhone: TEST_PHONE,
      accountRef: created.reference,
      paidAt: today,
      note: "verify-part-d A",
    }),
    campaignSlug: CAMPAIGN_SLUG,
    adminId,
  });

  const paymentB = await payments.record(db, {
    input: recordPaymentInput.parse({
      method: "cash",
      externalRef: "",
      amountKes: 15_000,
      payerName: "Allocation Verification",
      payerPhone: TEST_PHONE,
      accountRef: created.reference,
      paidAt: today,
      note: "verify-part-d B",
    }),
    campaignSlug: CAMPAIGN_SLUG,
    adminId,
  });

  show([
    { payment: "A", id: paymentA.paymentId, amountMinor: paymentA.amountMinor },
    { payment: "B", id: paymentB.paymentId, amountMinor: paymentB.amountMinor },
  ]);

  /*
   * The totals baseline is taken here, after the payments are recorded and
   * before any of them is allocated. Allocation must not move it: received_minor
   * counts every received payment regardless of allocation, and pledged_minor
   * counts verified and fulfilled alike, so the fulfilled transition is a no-op
   * for the public figure. Anything else means one of those views changed
   * meaning.
   */
  const totalsBefore = await campaign.getTotals(db, {
    campaignSlug: CAMPAIGN_SLUG,
  });

  // 3. Allocate payment A with no amount, so the default is worked out
  heading("3. allocate payment A, amount defaulted");
  const first = await payments.allocate(db, {
    paymentId: paymentA.paymentId,
    input: { pledgeId },
    adminId,
    request: { ip: "203.0.113.20", userAgent: "verify-part-d" },
  });
  show(await balances(pledgeId));
  const afterFirst = await balanceOf(pledgeId);
  check(
    "default amount is the lesser side, 1000000",
    first.amountMinor === 1_000_000n,
  );
  check("paid_minor increased to 1000000", afterFirst.paidMinor === 1_000_000n);
  check(
    "outstanding_minor decreased to 1500000",
    afterFirst.outstandingMinor === 1_500_000n,
  );
  check("pledge is still verified, not fulfilled", afterFirst.status === "verified");
  check("service reports it did not fulfil", first.pledgeFulfilled === false);
  check(
    "payment A now has nothing unallocated",
    first.paymentUnallocatedMinor === 0n,
  );

  // 4. The service rejects over allocation before the trigger has to
  heading("4. over allocation is refused at the service level");
  const refusals: { attempt: string; code: string; message: string }[] = [];

  const expectRefusal = async (attempt: string, run: () => Promise<unknown>) => {
    try {
      await run();
      check(`refused: ${attempt}`, false, "it was allowed");
    } catch (error) {
      if (!isServiceError(error)) throw error;
      refusals.push({ attempt, code: error.code, message: error.message });
      check(`refused: ${attempt}`, true, error.code);
    }
  };

  await expectRefusal("a payment that is already fully allocated", () =>
    payments.allocate(db, {
      paymentId: paymentA.paymentId,
      input: { pledgeId },
      adminId,
    }),
  );

  await expectRefusal("an amount larger than the payment", () =>
    payments.allocate(db, {
      paymentId: paymentB.paymentId,
      input: { pledgeId, amountMinor: 2_000_000n },
      adminId,
    }),
  );

  show(refusals);
  check(
    "the refusal states the exact numbers",
    refusals.some((r) => r.message.includes("1500000")),
  );

  // 5. Allocate payment B, which closes the balance
  heading("5. allocate payment B, which fulfils the pledge");
  const second = await payments.allocate(db, {
    paymentId: paymentB.paymentId,
    input: { pledgeId },
    adminId,
    request: { ip: "203.0.113.20", userAgent: "verify-part-d" },
  });
  show(await balances(pledgeId));
  const afterSecond = await balanceOf(pledgeId);
  check("paid_minor is the full 2500000", afterSecond.paidMinor === 2_500_000n);
  check("outstanding_minor is 0", afterSecond.outstandingMinor === 0n);
  check("pledge auto-transitioned to fulfilled", afterSecond.status === "fulfilled");
  check("service reports it fulfilled the pledge", second.pledgeFulfilled === true);

  // 6. Campaign totals are untouched by allocation
  heading("6. campaign totals across the allocations");
  const totalsAfter = await campaign.getTotals(db, {
    campaignSlug: CAMPAIGN_SLUG,
  });
  show([
    { when: "before allocating", ...totalsBefore },
    { when: "after allocating", ...totalsAfter },
  ]);
  check(
    "pledged_minor is unchanged by allocation",
    totalsAfter.pledgedMinor === totalsBefore.pledgedMinor,
  );
  check(
    "received_minor is unchanged by allocation",
    totalsAfter.receivedMinor === totalsBefore.receivedMinor,
  );
  check(
    "pledge_count is unchanged by allocation",
    totalsAfter.pledgeCount === totalsBefore.pledgeCount,
  );

  // 7. Reverse the second allocation
  heading("7. remove the allocation, and the pledge reverts");
  const reversal = await payments.deallocate(db, {
    paymentId: paymentB.paymentId,
    allocationId: second.allocationId,
    adminId,
    request: { ip: "203.0.113.20", userAgent: "verify-part-d" },
  });
  show(await balances(pledgeId));
  const afterReversal = await balanceOf(pledgeId);
  check("paid_minor is back to 1000000", afterReversal.paidMinor === 1_000_000n);
  check(
    "outstanding_minor is back to 1500000",
    afterReversal.outstandingMinor === 1_500_000n,
  );
  check("pledge reverted to verified", afterReversal.status === "verified");
  check("service reports it reverted the pledge", reversal.pledgeReverted === true);

  // 8. The correction is a new fact, not a deletion
  heading("8. the reversed allocation row survives");
  const survivors = await db.execute(sql`
    select id, amount_minor, allocated_at is not null as allocated,
           reversed_at is not null as reversed, reversed_by
    from payment_allocations
    where payment_id = ${paymentB.paymentId}
  `);
  show(survivors.rows as Record<string, unknown>[]);
  check("the row was reversed, not deleted", survivors.rows.length === 1);
  check(
    "reversed_by records who made the correction",
    String((survivors.rows[0] as { reversed_by: string }).reversed_by) === adminId,
  );

  // 9. A reversal frees the amount for reallocation
  heading("9. the freed amount can be allocated again");
  const third = await payments.allocate(db, {
    paymentId: paymentB.paymentId,
    input: { pledgeId },
    adminId,
  });
  show(await balances(pledgeId));
  const afterThird = await balanceOf(pledgeId);
  check(
    "the full amount was allocatable again",
    third.amountMinor === 1_500_000n,
  );
  check("paid_minor is 2500000 again", afterThird.paidMinor === 2_500_000n);
  check("pledge is fulfilled again", afterThird.status === "fulfilled");

  // 10. The trigger is still the backstop
  heading("10. the database refuses an over allocation the service never sees");
  let triggerFired = false;
  let triggerMessage = "";
  try {
    await db.execute(sql`
      insert into payment_allocations (payment_id, pledge_id, amount_minor)
      values (${paymentA.paymentId}, ${pledgeId}, 100)
    `);
  } catch (error) {
    triggerFired = true;
    // Drizzle wraps the driver error, and the raise from the trigger sits on
    // the cause underneath. The top level message is only "Failed query".
    let current: unknown = error;
    for (let depth = 0; current instanceof Error && depth < 5; depth++) {
      triggerMessage = current.message;
      current = current.cause;
    }
  }
  console.log(`  ${triggerMessage.split("\n")[0]}`);
  check(
    "the database names the payment and both amounts",
    triggerMessage.includes("exceeds the payment amount"),
  );
  check("a direct insert past the payment amount is rejected", triggerFired);

  // 11. Audit trail
  heading("11. audit_log rows written by this run");
  const auditRows = await db.execute(sql`
    select action,
           actor_type,
           actor_id,
           entity,
           coalesce(after ->> 'pledgeReference', before ->> 'pledgeReference',
                    after ->> 'reference') as pledge_reference,
           coalesce(after ->> 'amountMinor', before ->> 'amountMinor') as amount_minor,
           before ->> 'status' as before_status,
           after  ->> 'status' as after_status
    from audit_log
    where entity_id in (
            ${pledgeId},
            ${first.allocationId},
            ${second.allocationId},
            ${third.allocationId}
          )
      and action in ('payment.allocated', 'payment.deallocated',
                     'pledge.fulfilled', 'pledge.unfulfilled')
    order by id
  `);
  show(auditRows.rows as Record<string, unknown>[]);

  const actions = (auditRows.rows as { action: string }[]).map((r) => r.action);
  const countOf = (action: string) =>
    actions.filter((a) => a === action).length;

  check("three payment.allocated rows", countOf("payment.allocated") === 3);
  check("one payment.deallocated row", countOf("payment.deallocated") === 1);
  check("two pledge.fulfilled rows", countOf("pledge.fulfilled") === 2);
  check("one pledge.unfulfilled row", countOf("pledge.unfulfilled") === 1);
  check(
    "every row names the pledge reference",
    (auditRows.rows as { pledge_reference: string | null }[]).every(
      (r) => r.pledge_reference === created.reference,
    ),
  );
  check(
    "every row carries the acting admin",
    (auditRows.rows as { actor_id: string | null }[]).every(
      (r) => r.actor_id === adminId,
    ),
  );

  // 12. Clean up
  heading("12. cleanup");
  await db.execute(sql`
    delete from payment_allocations
    where payment_id in (${paymentA.paymentId}, ${paymentB.paymentId})
  `);
  await db.execute(sql`
    delete from payments
    where id in (${paymentA.paymentId}, ${paymentB.paymentId})
  `);
  await db.execute(sql`
    delete from pledges
    where pledger_id in (
      select id from pledgers where phone_e164 like ${`${TEST_PHONE_PREFIX}%`}
    )
  `);
  await db.execute(sql`
    delete from pledgers where phone_e164 like ${`${TEST_PHONE_PREFIX}%`}
  `);
  /*
   * Any verification admin, not just one this run created.
   *
   * Deleting only the id this run made left a dangling row behind whenever the
   * script failed before its cleanup: the next run then found that row, took it
   * as the existing admin, created nothing, and so deleted nothing either.
   * Rows with an auth_user_id are real accounts and are never touched.
   */
  void temporaryAdminId;
  await db.execute(sql`
    delete from admin_users
    where email like 'verify-part-%@example.test' and auth_user_id is null
  `);

  const totalsFinal = await campaign.getTotals(db, {
    campaignSlug: CAMPAIGN_SLUG,
  });
  show([{ when: "after cleanup", ...totalsFinal }]);

  heading("result");
  if (failures.length > 0) {
    console.error(`${failures.length} check(s) failed:`);
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }
  console.log("all checks passed");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
