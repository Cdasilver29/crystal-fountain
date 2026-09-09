import { config } from "dotenv";

// Load the environment before anything imports src/env.ts.
config({ path: ".env.local" });

/**
 * Reconciliation suggestion verification.
 *
 * Builds three pledges that each match a payment by a different signal, then
 * checks that suggestMatches ranks them reference, phone, name and excludes the
 * pledges it should never offer.
 *
 * Usage: pnpm db:verify:suggestions
 *
 * Everything it creates is removed at the end, apart from audit_log rows, which
 * are append only by design.
 */

const CAMPAIGN_SLUG = "crystal-fountain";
const TEST_PHONE_PREFIX = "+2547999";

// One number belongs to the payer, the others do not.
const PAYER_PHONE = "0799944444";
const OTHER_PHONE = "0799955555";
const NAME_PHONE = "0799966666";
const PAID_PHONE = "0799977777";
const CANCELLED_PHONE = "0799988888";

const PAYER_NAME = "Mwangi";

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
  const { createPledgeInput } = await import("@/server/contracts/pledges");
  const { recordPaymentInput } = await import("@/server/contracts/payments");

  const failures: string[] = [];
  const check = (label: string, ok: boolean, detail?: string) => {
    if (!ok) failures.push(label);
    console.log(`${ok ? "pass" : "FAIL"}  ${label}${detail ? `  ${detail}` : ""}`);
  };

  /*
   * Remove anything this script left behind, then run.
   *
   * Called at the start as well as the end, because a run that fails partway
   * leaves pledges with test phone numbers in the table, and the next run would
   * then match them and report a ranking failure that is really a data
   * failure. Sweeping first makes the script idempotent.
   *
   * Order matters: allocations reference payments and pledges, pledges
   * reference pledgers.
   */
  const sweep = async () => {
    const phones = `${TEST_PHONE_PREFIX}%`;
    await db.execute(sql`
      delete from payment_allocations
      where payment_id in (
              select id from payments
              where payer_msisdn like ${phones}
                 or external_ref like ${"VERIFYF%"}
            )
         or pledge_id in (
              select id from pledges
              where pledger_id in (select id from pledgers where phone_e164 like ${phones})
            )
    `);
    await db.execute(sql`
      delete from payments
      where payer_msisdn like ${phones} or external_ref like ${"VERIFYF%"}
    `);
    await db.execute(sql`
      delete from pledges
      where pledger_id in (select id from pledgers where phone_e164 like ${phones})
    `);
    await db.execute(sql`
      delete from pledgers where phone_e164 like ${phones}
    `);
  };

  await sweep();

  const [existingAdmin] = (
    await db.execute(sql`
      select id from admin_users where is_active order by created_at limit 1
    `)
  ).rows as { id: string }[];

  let temporaryAdminId: string | null = null;

  if (!existingAdmin) {
    const inserted = await db.execute(sql`
      insert into admin_users (email, full_name, role)
      values ('verify-part-f@example.test', 'Verification Treasurer', 'treasurer')
      returning id
    `);
    temporaryAdminId = String((inserted.rows as { id: string }[])[0].id);
  }

  const adminId = existingAdmin?.id ?? temporaryAdminId!;

  const makePledge = async (fullName: string, phone: string, amountKes: number) => {
    const created = await pledges.create(db, {
      input: createPledgeInput.parse({
        fullName,
        phone,
        amountKes,
        intent: "one_off",
        recordConsent: true,
        contactConsent: false,
        displayConsent: false,
      }),
      campaignSlug: CAMPAIGN_SLUG,
    });
    await pledges.approve(db, { pledgeId: created.pledgeId, adminId });
    return created;
  };

  // 1. Five pledges: three that should be suggested, two that should not
  heading("1. the pledges");
  /*
   * The three signals deliberately point at three different pledges, so the
   * ranking is unambiguous. If the payer's phone sat on the reference pledge
   * too, a broken ranking could still put that pledge first and the test would
   * pass for the wrong reason.
   *
   * So: the payment's account reference names the first pledge, the payment's
   * phone belongs to the second, and the payment's payer name is contained in
   * the third.
   */
  const referenceHit = await makePledge("Referenced Person", OTHER_PHONE, 30_000);
  const phoneHit = await makePledge("Phoned Person", PAYER_PHONE, 20_000);
  const nameHit = await makePledge(`Grace ${PAYER_NAME} Otieno`, NAME_PHONE, 10_000);
  const alreadyPaid = await makePledge("Settled Person", PAID_PHONE, 5_000);
  const cancelled = await makePledge("Cancelled Person", CANCELLED_PHONE, 8_000);

  // One pledge is settled in full, so it must never be suggested.
  const settlingPayment = await payments.record(db, {
    input: recordPaymentInput.parse({
      method: "cash",
      externalRef: "",
      amountKes: 5_000,
      payerName: "Settled Person",
      payerPhone: PAID_PHONE,
      accountRef: alreadyPaid.reference,
      paidAt: new Date().toISOString().slice(0, 10),
      note: "verify-part-f settling",
    }),
    campaignSlug: CAMPAIGN_SLUG,
    adminId,
  });
  await payments.allocate(db, {
    paymentId: settlingPayment.paymentId,
    input: { pledgeId: alreadyPaid.pledgeId },
    adminId,
  });

  // And one is cancelled, which allocate() would refuse anyway.
  await db.execute(sql`
    update pledges set status = 'cancelled' where id = ${cancelled.pledgeId}
  `);

  show([
    { role: "reference match", reference: referenceHit.reference, phone: OTHER_PHONE },
    { role: "phone match", reference: phoneHit.reference, phone: PAYER_PHONE },
    { role: "name match", reference: nameHit.reference, phone: NAME_PHONE },
    { role: "fully paid, excluded", reference: alreadyPaid.reference, phone: PAID_PHONE },
    { role: "cancelled, excluded", reference: cancelled.reference, phone: CANCELLED_PHONE },
  ]);

  // 2. A payment carrying all three signals at once
  heading("2. a payment carrying all three signals");
  const payment = await payments.record(db, {
    input: recordPaymentInput.parse({
      method: "mpesa",
      externalRef: `VERIFYF${Date.now().toString().slice(-6)}`,
      amountKes: 12_000,
      // Matches "Grace Mwangi Otieno" by containment, in the payer to pledger
      // direction.
      payerName: PAYER_NAME,
      payerPhone: PAYER_PHONE,
      // Lower cased and padded, to prove the trim and the case fold.
      accountRef: `  ${referenceHit.reference.toLowerCase()}  `,
      paidAt: new Date().toISOString().slice(0, 10),
      note: "verify-part-f subject",
    }),
    campaignSlug: CAMPAIGN_SLUG,
    adminId,
  });

  const suggestions = await payments.suggestMatches(db, {
    paymentId: payment.paymentId,
  });

  show(
    suggestions.map((row, index) => ({
      position: index + 1,
      reference: row.reference,
      full_name: row.fullName,
      outstanding_minor: row.outstandingMinor,
      match_reason: row.matchReason,
      confidence: row.confidence,
    })),
  );

  check("three pledges are suggested", suggestions.length === 3);
  check(
    "the reference match ranks first",
    suggestions[0]?.pledgeId === referenceHit.pledgeId &&
      suggestions[0]?.matchReason === "reference",
  );
  check("the reference match is high confidence", suggestions[0]?.confidence === "high");
  check(
    "the phone match ranks second",
    suggestions[1]?.pledgeId === phoneHit.pledgeId &&
      suggestions[1]?.matchReason === "phone",
  );
  check("the phone match is medium confidence", suggestions[1]?.confidence === "medium");
  check(
    "the name match ranks third",
    suggestions[2]?.pledgeId === nameHit.pledgeId &&
      suggestions[2]?.matchReason === "name",
  );
  check("the name match is low confidence", suggestions[2]?.confidence === "low");
  check(
    "a lower cased padded account reference still matches",
    suggestions[0]?.reference === referenceHit.reference,
  );
  check(
    "outstanding balances come back with the suggestion",
    suggestions[0]?.outstandingMinor === 3_000_000n,
  );

  // 3. What must never be suggested
  heading("3. exclusions");
  const suggestedIds = suggestions.map((row) => row.pledgeId);
  check(
    "a pledge with nothing outstanding is not suggested",
    !suggestedIds.includes(alreadyPaid.pledgeId),
  );
  check(
    "a cancelled pledge is not suggested",
    !suggestedIds.includes(cancelled.pledgeId),
  );
  check(
    "each pledge appears once, even matching on two signals",
    new Set(suggestedIds).size === suggestedIds.length,
  );

  // 4. A payment with nothing to go on
  heading("4. a payment with no reference, phone or name");
  const blind = await payments.record(db, {
    input: recordPaymentInput.parse({
      method: "cash",
      // Carries a reference only so the sweep can find it. A cash payment with
      // no payer phone is otherwise indistinguishable from real data.
      externalRef: "VERIFYFBLIND",
      amountKes: 1_000,
      payerName: "",
      payerPhone: "",
      accountRef: "",
      paidAt: new Date().toISOString().slice(0, 10),
      note: "verify-part-f blind",
    }),
    campaignSlug: CAMPAIGN_SLUG,
    adminId,
  });
  const none = await payments.suggestMatches(db, { paymentId: blind.paymentId });
  check("no signals means no guesses", none.length === 0, `${none.length} rows`);

  // 5. The detail read
  heading("5. getForAdmin");
  const detail = await payments.getForAdmin(db, {
    paymentId: settlingPayment.paymentId,
  });
  show([
    {
      amount_minor: detail?.amountMinor,
      allocated_minor: detail?.allocatedMinor,
      unallocated_minor: detail?.unallocatedMinor,
      allocation_status: detail?.allocationStatus,
      allocations: detail?.allocations.length,
      allocated_by: detail?.allocations[0]?.allocatedByName,
    },
  ]);
  check("the payment is found", detail !== null);
  check("its allocation is listed", detail?.allocations.length === 1);
  check(
    "the allocation names who made it",
    typeof detail?.allocations[0]?.allocatedByName === "string",
  );
  check("it reads as fully allocated", detail?.allocationStatus === "fully_allocated");
  check(
    "an unknown payment is null, not a throw",
    (await payments.getForAdmin(db, {
      paymentId: "00000000-0000-4000-8000-000000000000",
    })) === null,
  );

  // 6. Clean up
  heading("6. cleanup");
  await sweep();
  if (temporaryAdminId) {
    await db.execute(sql`delete from admin_users where id = ${temporaryAdminId}`);
  }
  console.log("  test rows removed");

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
