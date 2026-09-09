import { config } from "dotenv";

// Load the environment before anything imports src/env.ts.
config({ path: ".env.local" });

/**
 * Payment book and pledge search verification.
 *
 * Covers the allocation status derived in SQL, the keyset pagination, and the
 * three ways of finding a pledge. Every figure is read back out of the services
 * and checked against v_pledge_balances, not against application logs.
 *
 * Usage: pnpm db:verify:payments
 *
 * Everything it creates is removed at the end, apart from audit_log rows, which
 * are append only by design.
 */

const CAMPAIGN_SLUG = "crystal-fountain";
const TEST_PHONE = "0799933333";
const TEST_PHONE_PREFIX = "+2547999";
const TEST_NAME = "Zipporah Wanjiku Testcase";

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

  // An admin to attribute the allocations to. allocated_by is a foreign key.
  const [existingAdmin] = (
    await db.execute(sql`
      select id from admin_users where is_active order by created_at limit 1
    `)
  ).rows as { id: string }[];

  let temporaryAdminId: string | null = null;

  if (!existingAdmin) {
    const inserted = await db.execute(sql`
      insert into admin_users (email, full_name, role)
      values ('verify-part-e@example.test', 'Verification Treasurer', 'treasurer')
      returning id
    `);
    temporaryAdminId = String((inserted.rows as { id: string }[])[0].id);
  }

  const adminId = existingAdmin?.id ?? temporaryAdminId!;

  // 1. A pledge to match payments against
  heading("1. a verified pledge of KES 25,000");
  const created = await pledges.create(db, {
    input: createPledgeInput.parse({
      fullName: TEST_NAME,
      phone: TEST_PHONE,
      amountKes: 25_000,
      intent: "one_off",
      recordConsent: true,
      contactConsent: false,
      displayConsent: false,
    }),
    campaignSlug: CAMPAIGN_SLUG,
  });
  await pledges.approve(db, { pledgeId: created.pledgeId, adminId });
  show([{ reference: created.reference, name: TEST_NAME, phone: TEST_PHONE }]);

  // 2. Three payments in the three allocation states
  heading("2. three payments, one of each allocation state");
  const today = new Date().toISOString().slice(0, 10);

  const recordOne = async (amountKes: number, note: string) =>
    payments.record(db, {
      input: recordPaymentInput.parse({
        method: "cash",
        externalRef: "",
        amountKes,
        payerName: TEST_NAME,
        payerPhone: TEST_PHONE,
        accountRef: created.reference,
        paidAt: today,
        note,
      }),
      campaignSlug: CAMPAIGN_SLUG,
      adminId,
    });

  const unallocated = await recordOne(5_000, "verify-part-e unallocated");
  const partial = await recordOne(10_000, "verify-part-e partial");
  const full = await recordOne(7_000, "verify-part-e full");

  // KES 3,000 of the 10,000, leaving 7,000 unmatched.
  const partialAllocation = await payments.allocate(db, {
    paymentId: partial.paymentId,
    input: { pledgeId: created.pledgeId, amountMinor: 300_000n },
    adminId,
  });
  // All 7,000 of the 7,000.
  await payments.allocate(db, {
    paymentId: full.paymentId,
    input: { pledgeId: created.pledgeId },
    adminId,
  });

  const listed = await payments.listForAdmin(db, {
    campaignSlug: CAMPAIGN_SLUG,
    limit: 100,
  });

  const byId = new Map(listed.items.map((row) => [row.id, row]));
  const mine = [
    { label: "unallocated", id: unallocated.paymentId },
    { label: "partial", id: partial.paymentId },
    { label: "fully allocated", id: full.paymentId },
  ];

  show(
    mine.map(({ label, id }) => {
      const row = byId.get(id);
      return {
        expected: label,
        amount_minor: row?.amountMinor,
        allocated_minor: row?.allocatedMinor,
        unallocated_minor: row?.unallocatedMinor,
        allocation_status: row?.allocationStatus,
      };
    }),
  );

  check(
    "unmatched payment reads as unallocated",
    byId.get(unallocated.paymentId)?.allocationStatus === "unallocated",
  );
  check(
    "part matched payment reads as partial",
    byId.get(partial.paymentId)?.allocationStatus === "partial",
  );
  check(
    "partial remainder is 700000",
    byId.get(partial.paymentId)?.unallocatedMinor === 700_000n,
  );
  check(
    "fully matched payment reads as fully_allocated",
    byId.get(full.paymentId)?.allocationStatus === "fully_allocated",
  );
  check(
    "fully matched payment has nothing left",
    byId.get(full.paymentId)?.unallocatedMinor === 0n,
  );
  check(
    "the list is ordered newest paid_at first",
    listed.items.every(
      (row, i) =>
        i === 0 || listed.items[i - 1].paidAt.getTime() >= row.paidAt.getTime(),
    ),
  );

  // 3. A reversal frees the payment on this screen too
  heading("3. reversing an allocation frees the payment");
  await payments.deallocate(db, {
    paymentId: partial.paymentId,
    allocationId: partialAllocation.allocationId,
    adminId,
  });
  const afterReversal = await payments.listForAdmin(db, {
    campaignSlug: CAMPAIGN_SLUG,
    limit: 100,
  });
  const reversedRow = afterReversal.items.find(
    (row) => row.id === partial.paymentId,
  );
  show([
    {
      allocated_minor: reversedRow?.allocatedMinor,
      unallocated_minor: reversedRow?.unallocatedMinor,
      allocation_status: reversedRow?.allocationStatus,
    },
  ]);
  check(
    "the reversed allocation is not counted",
    reversedRow?.allocatedMinor === 0n,
  );
  check(
    "the payment reads as unallocated again",
    reversedRow?.allocationStatus === "unallocated",
  );

  // 4. Keyset pagination
  heading("4. cursor pagination");
  const pageOne = await payments.listForAdmin(db, {
    campaignSlug: CAMPAIGN_SLUG,
    limit: 2,
  });
  check("page one holds exactly the limit", pageOne.items.length === 2);
  check("page one offers a next cursor", pageOne.nextCursor !== null);

  const pageTwo = await payments.listForAdmin(db, {
    campaignSlug: CAMPAIGN_SLUG,
    limit: 2,
    cursor: pageOne.nextCursor,
  });
  show([
    ...pageOne.items.map((r) => ({ page: 1, id: r.id, paid_at: r.paidAt.toISOString() })),
    ...pageTwo.items.map((r) => ({ page: 2, id: r.id, paid_at: r.paidAt.toISOString() })),
  ]);

  const pageOneIds = new Set(pageOne.items.map((r) => r.id));
  check(
    "page two repeats nothing from page one",
    pageTwo.items.every((r) => !pageOneIds.has(r.id)),
  );

  const boundary = pageOne.items[pageOne.items.length - 1];
  check(
    "page two starts strictly after the page one boundary",
    pageTwo.items.every(
      (r) =>
        r.paidAt.getTime() < boundary.paidAt.getTime() ||
        (r.paidAt.getTime() === boundary.paidAt.getTime() && r.id < boundary.id),
    ),
  );

  // Walking the whole book must see each of the three payments exactly once.
  const seen: string[] = [];
  let cursor: string | null = null;
  for (let guard = 0; guard < 50; guard++) {
    const page = await payments.listForAdmin(db, {
      campaignSlug: CAMPAIGN_SLUG,
      limit: 2,
      cursor,
    });
    seen.push(...page.items.map((r) => r.id));
    if (!page.nextCursor) break;
    cursor = page.nextCursor;
  }
  check(
    "walking every page yields no duplicates",
    new Set(seen).size === seen.length,
  );
  check(
    "walking every page finds all three payments",
    mine.every(({ id }) => seen.includes(id)),
  );

  const nonsense = await payments.listForAdmin(db, {
    campaignSlug: CAMPAIGN_SLUG,
    limit: 2,
    cursor: "not-a-cursor",
  });
  check(
    "a malformed cursor falls back to the first page",
    nonsense.items[0]?.id === pageOne.items[0]?.id,
  );

  // 5. Pledge search
  heading("5. pledge search, three ways in");
  const searchFor = (q: string, revealPhone = true) =>
    pledges.search(db, { campaignSlug: CAMPAIGN_SLUG, q, revealPhone });

  const byReference = await searchFor(created.reference);
  const byPrefix = await searchFor(created.reference.slice(0, 9));
  const byPhone = await searchFor("933333");
  const byName = await searchFor("wanjiku");

  show([
    { term: created.reference, hits: byReference.length, reason: byReference[0]?.matchReason },
    { term: created.reference.slice(0, 9), hits: byPrefix.length, reason: byPrefix[0]?.matchReason },
    { term: "933333", hits: byPhone.length, reason: byPhone[0]?.matchReason },
    { term: "wanjiku", hits: byName.length, reason: byName[0]?.matchReason },
  ]);

  check(
    "full reference finds the pledge",
    byReference.some((r) => r.pledgeId === created.pledgeId),
  );
  check("full reference is reported as a reference match", byReference[0]?.matchReason === "reference");
  check(
    "reference prefix finds the pledge",
    byPrefix.some((r) => r.pledgeId === created.pledgeId),
  );
  check(
    "phone suffix finds the pledge",
    byPhone.some((r) => r.pledgeId === created.pledgeId),
  );
  check(
    "phone suffix is reported as a phone match",
    byPhone.find((r) => r.pledgeId === created.pledgeId)?.matchReason === "phone",
  );
  check(
    "part of a name finds the pledge",
    byName.some((r) => r.pledgeId === created.pledgeId),
  );
  check(
    "name is reported as a name match",
    byName.find((r) => r.pledgeId === created.pledgeId)?.matchReason === "name",
  );

  const hit = byReference.find((r) => r.pledgeId === created.pledgeId)!;
  show([
    {
      reference: hit.reference,
      full_name: hit.fullName,
      phone: hit.phone,
      amount_minor: hit.amountMinor,
      paid_minor: hit.paidMinor,
      outstanding_minor: hit.outstandingMinor,
      status: hit.status,
    },
  ]);
  check("search carries the pledged amount", hit.amountMinor === 2_500_000n);
  check(
    "search carries paid_minor from v_pledge_balances",
    hit.paidMinor === 700_000n,
  );
  check(
    "search carries outstanding_minor from v_pledge_balances",
    hit.outstandingMinor === 1_800_000n,
  );

  // 6. Phone masking and LIKE escaping
  heading("6. a viewer sees a masked number, and wildcards are literal");
  const masked = (
    await pledges.search(db, {
      campaignSlug: CAMPAIGN_SLUG,
      q: created.reference,
      revealPhone: false,
    })
  ).find((r) => r.pledgeId === created.pledgeId)!;
  show([{ treasurer: hit.phone, viewer: masked.phone }]);
  check("a treasurer sees the whole number", hit.phone === "+254799933333");
  check("a viewer does not", !masked.phone.includes("799933"));
  check("a viewer still sees the last three digits", masked.phone.endsWith("333"));

  const wildcard = await searchFor("100%");
  check(
    "a percent sign is searched for, not treated as a wildcard",
    wildcard.length === 0,
    `${wildcard.length} rows`,
  );
  const tooShort = await searchFor("33");
  check(
    "two digits do not match every phone number",
    !tooShort.some((r) => r.matchReason === "phone"),
  );

  // 7. Clean up
  heading("7. cleanup");
  await db.execute(sql`
    delete from payment_allocations
    where payment_id in (${unallocated.paymentId}, ${partial.paymentId}, ${full.paymentId})
  `);
  await db.execute(sql`
    delete from payments
    where id in (${unallocated.paymentId}, ${partial.paymentId}, ${full.paymentId})
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
