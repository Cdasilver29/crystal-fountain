import { config } from "dotenv";

// Load the environment before anything imports src/env.ts.
config({ path: ".env.local" });

/**
 * Deciding a pledge change request, session C2a.
 *
 * The half that touches money. Raising a request writes one row and changes
 * nothing; approving one changes a pledge, and this proves it changes it the
 * way the rest of the system already does: a reduction through the increment
 * ledger with a reason attached, the original submissions left alone, and the
 * decision and its consequence in one transaction.
 *
 * Everything is read back with SQL rather than from what the service claims it
 * did, and the campaign figure is checked as a delta against what it was
 * before the run rather than as an absolute.
 *
 * Usage: pnpm db:verify:change-decisions
 *
 * Its own pledges and its own addresses, separate from verify-part-ae, because
 * that suite deliberately exhausts a pledge's three requests a day and nothing
 * could be approved on one afterwards.
 *
 * Everything it creates is removed at the start and at the end, apart from
 * audit_log rows, which are append only by design.
 */

const CAMPAIGN_SLUG = "crystal-fountain";
const PHONES = {
  reduce: "0799900061",
  plan: "0799900062",
  named: "0799900063",
  unnamed: "0799900064",
  cancel: "0799900065",
  payment: "0799900066",
  closing: "0799900067",
};
const TEST_IP = "198.51.100.21";

const REASON = "My circumstances have changed and I need to adjust this.";

function refusal(error: unknown): string {
  const cause = (error as { cause?: { message?: string; detail?: string } })
    .cause;
  return cause?.detail ?? cause?.message ?? String(error);
}

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
  const requests = await import("@/server/services/change-requests");
  const campaign = await import("@/server/services/campaign");
  const { summarise } = await import("@/server/services/audit");
  const { AUDIT_TONES } = await import("@/components/admin/audit-table");
  const { normalizeKenyanPhone } = await import("@/server/contracts/phone");
  const {
    changeRequestInput,
    decideChangeRequestInput,
  } = await import("@/server/contracts/change-requests");
  const { isServiceError } = await import("@/server/errors");

  const failures: string[] = [];
  const check = (label: string, ok: boolean, detail?: string) => {
    if (!ok) failures.push(label);
    console.log(
      `${ok ? "pass" : "FAIL"}  ${label}${detail ? `  ${detail}` : ""}`,
    );
  };

  const e164 = Object.fromEntries(
    Object.entries(PHONES).map(([k, v]) => [k, normalizeKenyanPhone(v)!]),
  ) as Record<keyof typeof PHONES, string>;
  // Expanded into a value list rather than passed as an array parameter: the
  // driver sends a JS array in a way Postgres will not cast to text[] here.
  const allPhones = sql.join(
    Object.values(e164).map((p) => sql`${p}`),
    sql`, `,
  );

  const cleanup = async () => {
    await db.execute(sql`
      delete from pledge_change_requests
      where source_ip = ${TEST_IP}::inet
         or pledge_id in (
           select p.id from pledges p
           join pledgers g on g.id = p.pledger_id
           where g.phone_e164 in (${allPhones})
         )
    `);
    await db.execute(sql`
      delete from payment_allocations
      where pledge_id in (
        select p.id from pledges p
        join pledgers g on g.id = p.pledger_id
        where g.phone_e164 in (${allPhones})
      )
    `);
    await db.execute(sql`
      delete from pledges
      where pledger_id in (
        select id from pledgers where phone_e164 in (${allPhones})
      )
    `);
    await db.execute(sql`
      delete from pledgers where phone_e164 in (${allPhones})
    `);
  };

  await cleanup();

  const [adminRow] = (
    await db.execute(sql`
      select id::text as id, full_name
      from admin_users
      where is_active
      order by created_at
      limit 1
    `)
  ).rows as { id: string; full_name: string }[];

  if (!adminRow) {
    console.error("No active administrator to attribute decisions to.");
    process.exit(1);
  }

  const adminId = adminRow.id;
  const before = await campaign.getTotals(db, { campaignSlug: CAMPAIGN_SLUG });

  /**
   * A pledge with a phone number of its own, optionally already verified.
   *
   * The phone arrives already normalised. Calling the service directly skips
   * the contract, and the contract is the only thing that turns 0799900061
   * into +254799900061, so a raw number here would be stored raw and nothing
   * would ever find it again.
   */
  const makePledge = async (
    phone: string,
    amountKes: number,
    options: { displayConsent?: boolean; verify?: boolean } = {},
  ) => {
    const made = await pledges.create(db, {
      input: {
        fullName: "Decision Test",
        phone,
        intent: "one_off" as const,
        amountKes,
        recordConsent: true as const,
        contactConsent: false,
        displayConsent: options.displayConsent ?? false,
      },
      campaignSlug: CAMPAIGN_SLUG,
    });

    if (options.verify) {
      await pledges.approve(db, { pledgeId: made.pledgeId, adminId });
    }

    return made;
  };

  /** A request raised the way the member facing form will raise it. */
  const raise = async (
    reference: string,
    phone: string,
    fields: Record<string, unknown>,
  ) => {
    const result = await requests.create(db, {
      input: changeRequestInput.parse({
        reference,
        contactPhoneE164: phone,
        reason: REASON,
        ...fields,
      }),
      campaignSlug: CAMPAIGN_SLUG,
      request: { ip: TEST_IP, userAgent: "verify-part-af" },
    });
    return result.request;
  };

  const approval = decideChangeRequestInput.parse({ decision: "approve" });

  /* -----------------------------------------------------------------------
   * 1. Approving a reduction.
   * --------------------------------------------------------------------- */

  heading("1. approving a reduction");

  // Verified, so the reduction moves a figure the congregation can see.
  const reducible = await makePledge(e164.reduce, 500_000, { verify: true });
  const reduction = await raise(reducible.reference, PHONES.reduce, {
    kind: "reduce_amount",
    requestedAmountMinor: "30000000",
  });

  const approved = await requests.approve(db, {
    requestId: reduction.id,
    campaignSlug: CAMPAIGN_SLUG,
    input: approval,
    adminId,
    canDecideCancellation: true,
    request: { ip: TEST_IP, userAgent: "verify-part-af" },
  });

  show([
    {
      status: approved.status,
      kind: approved.kind,
      revalidatePublic: approved.revalidatePublic,
    },
  ]);
  check("it comes back approved", approved.status === "approved");
  check(
    "and says the public figure moved, so the caller revalidates",
    approved.revalidatePublic === true,
  );

  const afterReduce = await db.execute(sql`
    select p.amount_minor::text as amount_minor,
           p.installment_amount_minor::text as installment_amount_minor,
           r.status,
           r.decided_by::text as decided_by,
           r.decided_at is not null as has_decided_at
    from pledges p
    join pledge_change_requests r on r.pledge_id = p.id
    where p.id = ${reducible.pledgeId}::uuid
  `);
  show(afterReduce.rows as Record<string, unknown>[]);
  const reduced = afterReduce.rows[0] as {
    amount_minor: string;
    status: string;
    decided_by: string;
    has_decided_at: boolean;
  };
  check("the pledge is at the requested amount", reduced.amount_minor === "30000000");
  check("the request is marked approved", reduced.status === "approved");
  check("and carries who decided it", reduced.decided_by === adminId);
  check("and when", reduced.has_decided_at === true);

  /*
   * The whole point of reusing the pledge service: the reduction is a new row
   * in the ledger, not an edit of the old one.
   */
  const ledger = await db.execute(sql`
    select amount_minor::text as amount_minor, channel, reason
    from pledge_increments
    where pledge_id = ${reducible.pledgeId}::uuid
    order by created_at
  `);
  show(ledger.rows as Record<string, unknown>[]);
  const increments = ledger.rows as {
    amount_minor: string;
    channel: string;
    reason: string | null;
  }[];
  check("the original submission is untouched", increments[0]?.amount_minor === "50000000");
  check(
    "and the reduction is its own increment",
    increments[1]?.amount_minor === "-20000000",
  );
  check("written as an admin correction", increments[1]?.channel === "admin");
  check(
    "carrying the pledger's own reason",
    Boolean(increments[1]?.reason?.includes("circumstances")),
    increments[1]?.reason ?? "none",
  );

  const sums = await db.execute(sql`
    select p.amount_minor::text as amount_minor,
           sum(i.amount_minor)::text as increment_sum
    from pledges p
    join pledge_increments i on i.pledge_id = p.id
    where p.id = ${reducible.pledgeId}::uuid
    group by p.amount_minor
  `);
  const balance = sums.rows[0] as { amount_minor: string; increment_sum: string };
  check(
    "the amount still equals the sum of its increments",
    balance.amount_minor === balance.increment_sum,
    `${balance.amount_minor} = ${balance.increment_sum}`,
  );

  /* -----------------------------------------------------------------------
   * 2. A reduction that stopped being one.
   * --------------------------------------------------------------------- */

  heading("2. a reduction the pledge has outgrown");

  const grown = await makePledge(e164.plan, 400_000);
  const stale = await raise(grown.reference, PHONES.plan, {
    kind: "reduce_amount",
    requestedAmountMinor: "30000000",
  });

  /*
   * The figure a request was agreed against can move underneath it. Here the
   * treasurer has already corrected the pledge down to KES 200,000, so the
   * KES 300,000 the pledger asked for has quietly become an increase, and
   * approving it would raise a pledge through a queue that exists to lower
   * them.
   */
  await pledges.edit(db, {
    pledgeId: grown.pledgeId,
    input: { amountKes: 200_000, reason: "Corrected after speaking to them." },
    adminId,
  });

  try {
    await requests.approve(db, {
      requestId: stale.id,
      campaignSlug: CAMPAIGN_SLUG,
      input: approval,
      adminId,
      canDecideCancellation: true,
    });
    check("a reduction checked again at approval", false, "it was approved");
  } catch (error) {
    const service = isServiceError(error) ? error : null;
    check(
      "a reduction checked again at approval",
      service?.code === "reduction_no_longer_applies",
      service?.message ?? refusal(error),
    );
  }

  const untouched = await db.execute(sql`
    select amount_minor::text as amount_minor from pledges
    where id = ${grown.pledgeId}::uuid
  `);
  check(
    "and the pledge was left alone",
    (untouched.rows[0] as { amount_minor: string }).amount_minor === "20000000",
  );

  const stillPending = await requests.getPendingForPledge(db, {
    pledgeId: grown.pledgeId,
  });
  check(
    "the request is still pending, so it can be declined instead",
    stillPending?.id === stale.id,
  );

  /* -----------------------------------------------------------------------
   * 3. Approving a plan change.
   * --------------------------------------------------------------------- */

  heading("3. approving a plan change");

  await requests.decline(db, {
    requestId: stale.id,
    campaignSlug: CAMPAIGN_SLUG,
    input: decideChangeRequestInput.parse({
      decision: "decline",
      note: "The pledge has grown since you asked, so this would be an increase.",
    }),
    adminId,
    canDecideCancellation: true,
  });

  const planRequest = await raise(grown.reference, PHONES.plan, {
    kind: "change_plan",
    requestedFrequency: "monthly",
  });

  await requests.approve(db, {
    requestId: planRequest.id,
    campaignSlug: CAMPAIGN_SLUG,
    input: approval,
    adminId,
    canDecideCancellation: true,
  });

  const planned = await db.execute(sql`
    select intent,
           installment_frequency,
           installment_amount_minor::text as installment_amount_minor
    from pledges where id = ${grown.pledgeId}::uuid
  `);
  show(planned.rows as Record<string, unknown>[]);
  const plan = planned.rows[0] as {
    intent: string;
    installment_frequency: string;
    installment_amount_minor: string;
  };
  check("the plan is what was asked for", plan.installment_frequency === "monthly");
  check("and the intent follows it", plan.intent === "installment");
  check(
    "with the instalment recomputed off the whole pledge",
    // KES 200,000 over 36 months, rounded up to whole shillings.
    plan.installment_amount_minor === "555600",
    plan.installment_amount_minor,
  );

  /* -----------------------------------------------------------------------
   * 4. Approving a name correction.
   * --------------------------------------------------------------------- */

  heading("4. approving a name correction");

  const named = await makePledge(e164.named, 100_000, {
    displayConsent: true,
    verify: true,
  });
  const nameRequest = await raise(named.reference, PHONES.named, {
    kind: "correct_name",
    requestedName: "Jane Atieno Otieno",
  });

  const nameResult = await requests.approve(db, {
    requestId: nameRequest.id,
    campaignSlug: CAMPAIGN_SLUG,
    input: approval,
    adminId,
    canDecideCancellation: true,
  });

  const consented = await db.execute(sql`
    select g.full_name, g.display_name, g.display_consent
    from pledgers g
    join pledges p on p.pledger_id = g.id
    where p.id = ${named.pledgeId}::uuid
  `);
  show(consented.rows as Record<string, unknown>[]);
  const withConsent = consented.rows[0] as {
    full_name: string;
    display_name: string;
  };
  check("the stored name is corrected", withConsent.full_name === "Jane Atieno Otieno");
  check(
    "and the published one follows it",
    withConsent.display_name === "Jane Atieno Otieno",
  );
  check(
    "the caller is told to revalidate, because the list shows this name",
    nameResult.revalidatePublic === true,
  );

  const unnamed = await makePledge(e164.unnamed, 100_000, {
    displayConsent: false,
  });
  const quietRequest = await raise(unnamed.reference, PHONES.unnamed, {
    kind: "correct_name",
    requestedName: "Quiet Giver",
  });
  const quietResult = await requests.approve(db, {
    requestId: quietRequest.id,
    campaignSlug: CAMPAIGN_SLUG,
    input: approval,
    adminId,
    canDecideCancellation: true,
  });

  const withoutConsent = (
    await db.execute(sql`
      select g.full_name, g.display_name
      from pledgers g
      join pledges p on p.pledger_id = g.id
      where p.id = ${unnamed.pledgeId}::uuid
    `)
  ).rows[0] as { full_name: string; display_name: string | null };
  check("a name with no consent is still corrected", withoutConsent.full_name === "Quiet Giver");
  check(
    "but correcting it does not start publishing it",
    withoutConsent.display_name === null,
  );
  check("and nothing public moved", quietResult.revalidatePublic === false);

  /* -----------------------------------------------------------------------
   * 5. Approving a reported payment records nothing.
   * --------------------------------------------------------------------- */

  heading("5. a reported payment is routed, not recorded");

  const payer = await makePledge(e164.payment, 100_000);
  const paymentRequest = await raise(payer.reference, PHONES.payment, {
    kind: "payment_missing",
    paymentReference: "QVERIFYAF1",
    paymentAmountMinor: "5000000",
    paymentPaidOn: "2026-09-01",
  });

  const paymentsBefore = (
    await db.execute(sql`select count(*)::int as n from payments`)
  ).rows[0] as { n: number };

  const routed = await requests.approve(db, {
    requestId: paymentRequest.id,
    campaignSlug: CAMPAIGN_SLUG,
    input: approval,
    adminId,
    canDecideCancellation: true,
  });

  const paymentsAfter = (
    await db.execute(sql`select count(*)::int as n from payments`)
  ).rows[0] as { n: number };

  show([
    {
      paymentReference: routed.payment?.paymentReference,
      amountMinor: routed.payment?.amountMinor,
      paidOn: routed.payment?.paidOn,
      existingPaymentId: routed.payment?.existingPaymentId,
    },
  ]);
  check("no payment was recorded", paymentsAfter.n === paymentsBefore.n);
  check(
    "the treasurer is handed what the payment flow needs",
    routed.payment?.paymentReference === "QVERIFYAF1" &&
      routed.payment?.amountMinor === 5_000_000n &&
      routed.payment?.paidOn === "2026-09-01",
  );
  check(
    "and told nothing is already recorded under that code",
    routed.payment?.existingPaymentId === null,
  );

  /* -----------------------------------------------------------------------
   * 6. Cancelling is the administrator's alone.
   * --------------------------------------------------------------------- */

  heading("6. approving a cancellation");

  const doomed = await makePledge(e164.cancel, 250_000, { verify: true });
  const cancelRequest = await raise(doomed.reference, PHONES.cancel, {
    kind: "cancel_pledge",
  });

  try {
    await requests.approve(db, {
      requestId: cancelRequest.id,
      campaignSlug: CAMPAIGN_SLUG,
      input: approval,
      adminId,
      // What the route passes for a treasurer.
      canDecideCancellation: false,
    });
    check("a treasurer cannot approve one", false, "it was approved");
  } catch (error) {
    const service = isServiceError(error) ? error : null;
    check(
      "a treasurer cannot approve one",
      service?.code === "cancellation_needs_admin" && service?.status === 403,
      `${service?.code} ${service?.status}`,
    );
  }

  const survived = await db.execute(sql`
    select status from pledges where id = ${doomed.pledgeId}::uuid
  `);
  check(
    "and the pledge was left standing",
    (survived.rows[0] as { status: string }).status === "verified",
  );

  const cancelled = await requests.approve(db, {
    requestId: cancelRequest.id,
    campaignSlug: CAMPAIGN_SLUG,
    input: approval,
    adminId,
    canDecideCancellation: true,
  });

  const gone = await db.execute(sql`
    select p.status,
           p.cancelled_at is not null as has_cancelled_at,
           r.status as request_status
    from pledges p
    join pledge_change_requests r on r.pledge_id = p.id
    where p.id = ${doomed.pledgeId}::uuid
  `);
  show(gone.rows as Record<string, unknown>[]);
  const cancelledRow = gone.rows[0] as {
    status: string;
    has_cancelled_at: boolean;
    request_status: string;
  };
  check("an administrator can", cancelledRow.status === "cancelled");
  check("and the date is recorded", cancelledRow.has_cancelled_at === true);
  /*
   * The one ordering trap. Cancelling a pledge closes any request left pending
   * on it, and the request that asked for the cancellation must not be closed
   * by its own consequence.
   */
  check(
    "the request that asked for it reads approved, not closed",
    cancelledRow.request_status === "approved",
  );
  check("and the public figure moved", cancelled.revalidatePublic === true);

  /* -----------------------------------------------------------------------
   * 7. Answering something already answered.
   * --------------------------------------------------------------------- */

  heading("7. a request can only be answered once");

  try {
    await requests.approve(db, {
      requestId: cancelRequest.id,
      campaignSlug: CAMPAIGN_SLUG,
      input: approval,
      adminId,
      canDecideCancellation: true,
    });
    check("a second decision is refused", false, "it was approved again");
  } catch (error) {
    const service = isServiceError(error) ? error : null;
    check(
      "a second decision is refused",
      service?.code === "change_request_not_pending",
      service?.message ?? refusal(error),
    );
  }

  /* -----------------------------------------------------------------------
   * 8. Declining.
   * --------------------------------------------------------------------- */

  heading("8. declining");

  check(
    "the contract refuses a note too short to act on",
    decideChangeRequestInput.safeParse({ decision: "decline", note: "no" })
      .success === false,
  );
  check(
    "and requires one at all",
    decideChangeRequestInput.safeParse({ decision: "decline" }).success === false,
  );
  check(
    "while an approval needs none",
    decideChangeRequestInput.safeParse({ decision: "approve" }).success === true,
  );

  const declined = (
    await db.execute(sql`
      select status, decision_note, decided_by::text as decided_by
      from pledge_change_requests where id = ${stale.id}::uuid
    `)
  ).rows[0] as { status: string; decision_note: string; decided_by: string };
  check("the declined request says so", declined.status === "declined");
  check(
    "and keeps the note the pledger will be told",
    declined.decision_note.includes("would be an increase"),
  );
  check("attributed to whoever declined it", declined.decided_by === adminId);

  /* -----------------------------------------------------------------------
   * 9. A pledge that goes away closes what was waiting on it.
   * --------------------------------------------------------------------- */

  heading("9. closing a request whose pledge went away");

  const voided = await makePledge(e164.closing, 100_000, { verify: true });
  const waiting = await raise(voided.reference, PHONES.closing, {
    kind: "reduce_amount",
    requestedAmountMinor: "5000000",
  });

  await pledges.edit(db, {
    pledgeId: voided.pledgeId,
    input: { status: "void" },
    adminId,
  });

  const closed = (
    await db.execute(sql`
      select status, decision_note, decided_by, decided_at is not null as dated
      from pledge_change_requests where id = ${waiting.id}::uuid
    `)
  ).rows[0] as {
    status: string;
    decision_note: string;
    decided_by: string | null;
    dated: boolean;
  };
  show([closed as unknown as Record<string, unknown>]);
  check("voiding the pledge closed the request", closed.status === "closed");
  check("with a note saying why", closed.decision_note.includes("voided"));
  check("nobody is recorded as having decided it", closed.decided_by === null);
  check("but it carries the date it happened", closed.dated === true);

  const closureRow = (
    await db.execute(sql`
      select count(*)::int as n from audit_log
      where action = 'pledge.change_closed'
        and entity_id = ${voided.pledgeId}::uuid
    `)
  ).rows[0] as { n: number };
  check("and the journal records the closure", closureRow.n === 1);

  // The same on the delete path.
  const removable = await makePledge(e164.closing, 0 + 100_000);
  const alsoWaiting = await raise(removable.reference, PHONES.closing, {
    kind: "cancel_pledge",
  });

  await pledges.remove(db, {
    pledgeId: removable.pledgeId,
    adminId,
    reason: "verify-part-af",
  });

  const closedByDelete = (
    await db.execute(sql`
      select status, decision_note from pledge_change_requests
      where id = ${alsoWaiting.id}::uuid
    `)
  ).rows[0] as { status: string; decision_note: string };
  check("removing the pledge closed the request too", closedByDelete.status === "closed");
  check(
    "with its own note",
    closedByDelete.decision_note.includes("removed"),
  );

  /* -----------------------------------------------------------------------
   * 10. The badge, and the journal.
   * --------------------------------------------------------------------- */

  heading("10. the count and the journal");

  const waitingNow = await requests.countPending(db, {
    campaignSlug: CAMPAIGN_SLUG,
  });
  const waitingBySql = (
    await db.execute(sql`
      select count(*)::int as n
      from pledge_change_requests r
      join pledges p on p.id = r.pledge_id
      join campaigns c on c.id = p.campaign_id
      where c.slug = ${CAMPAIGN_SLUG} and r.status = 'pending'
    `)
  ).rows[0] as { n: number };
  check(
    "the pending count agrees with the database",
    waitingNow === waitingBySql.n,
    `${waitingNow} = ${waitingBySql.n}`,
  );

  for (const action of [
    "pledge.change_approved",
    "pledge.change_declined",
    "pledge.change_closed",
  ]) {
    check(`${action} has a colour of its own`, action in AUDIT_TONES);
  }

  const lines: [string, string, Record<string, unknown>, string][] = [
    [
      "an approved reduction reads as the new figure",
      "pledge.change_approved",
      { kind: "reduce_amount", amountMinor: "30000000" },
      "reduce to KES 300,000 approved",
    ],
    [
      "a decline names the kind",
      "pledge.change_declined",
      { kind: "cancel_pledge" },
      "cancel the pledge declined",
    ],
    [
      "a closure says what happened to the pledge",
      "pledge.change_closed",
      { kind: "reduce_amount", because: "pledge_voided" },
      "reduce the amount closed, the pledge was voided",
    ],
  ];

  for (const [label, action, after, expected] of lines) {
    const line = summarise(action, null, after);
    check(label, line === expected, `"${line}"`);
  }

  /* -----------------------------------------------------------------------
   * 11. Cleanup.
   * --------------------------------------------------------------------- */

  heading("11. cleanup");

  await cleanup();

  const totals = await campaign.getTotals(db, { campaignSlug: CAMPAIGN_SLUG });
  show([
    {
      pledged_before: before.pledgedMinor,
      pledged_after: totals.pledgedMinor,
      back_to_start: totals.pledgedMinor === before.pledgedMinor,
    },
  ]);
  check(
    "the campaign figure is back where it started",
    totals.pledgedMinor === before.pledgedMinor,
  );

  const left = (
    await db.execute(sql`
      select count(*)::int as n from pledge_change_requests
      where source_ip = ${TEST_IP}::inet
    `)
  ).rows[0] as { n: number };
  check("nothing this suite wrote was left behind", left.n === 0);

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
