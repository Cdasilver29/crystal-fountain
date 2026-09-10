import { config } from "dotenv";

// Load the environment before anything imports src/env.ts.
config({ path: ".env.local" });

/**
 * Pledge accumulation verification.
 *
 * Proves the thing the whole change exists for: a second pledge from a phone
 * number that already has one adds to it and keeps the same reference, the same
 * public token and therefore the same QR code. One person, one reference.
 *
 * Everything is read back with SQL rather than from what the service claims it
 * did, and the campaign figures are checked as deltas against what they were
 * before the run, not as absolutes, because this runs against a database that
 * already has pledges in it.
 *
 * Usage: pnpm db:verify:accumulation
 *
 * Everything it creates is removed at the end, apart from audit_log rows, which
 * are append only by design.
 */

const CAMPAIGN_SLUG = "crystal-fountain";
// Kenyan test range, and the same prefix the other verification scripts claim,
// so a failed run never leaves rows that look like a real pledger.
const TEST_PHONE = "0799900042";
const SECOND_PHONE = "0799900043";

/**
 * The message postgres actually sent.
 *
 * The driver wraps every failure in a DrizzleQueryError whose own message is
 * only "Failed query:", so a refusal printed straight off the caught error says
 * nothing about why it was refused.
 */
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
  const campaign = await import("@/server/services/campaign");
  const { normalizeKenyanPhone } = await import("@/server/contracts/phone");

  const failures: string[] = [];
  const check = (label: string, ok: boolean, detail?: string) => {
    if (!ok) failures.push(label);
    console.log(
      `${ok ? "pass" : "FAIL"}  ${label}${detail ? `  ${detail}` : ""}`,
    );
  };

  const phone = normalizeKenyanPhone(TEST_PHONE)!;
  const otherPhone = normalizeKenyanPhone(SECOND_PHONE)!;

  const cleanup = async () => {
    // Increments cascade with the pledge, so the pledges go first and take
    // their parts with them.
    await db.execute(sql`
      delete from pledges
      where pledger_id in (
        select id from pledgers where phone_e164 in (${phone}, ${otherPhone})
      )
    `);
    await db.execute(sql`
      delete from pledgers where phone_e164 in (${phone}, ${otherPhone})
    `);
  };

  await cleanup();

  const before = await campaign.getTotals(db, { campaignSlug: CAMPAIGN_SLUG });

  const base = {
    fullName: "Accumulation Test",
    phone,
    intent: "one_off" as const,
    recordConsent: true as const,
    contactConsent: false,
    displayConsent: false,
  };

  // 1. A first pledge from a number nobody has used.
  heading("1. a first pledge");
  const first = await pledges.create(db, {
    input: {
      ...base,
      amountKes: 250_000,
      category: "family",
      tier: "family_below_1m",
    },
    campaignSlug: CAMPAIGN_SLUG,
  });
  show([
    {
      reference: first.reference,
      amountMinor: first.amountMinor,
      addedMinor: first.addedMinor,
      previousAmountMinor: first.previousAmountMinor,
      isAddition: first.isAddition,
      status: first.status,
    },
  ]);
  check("a first pledge is not an addition", first.isAddition === false);
  check("previousAmountMinor is null on a first pledge", first.previousAmountMinor === null);
  check("the amount is the amount pledged", first.amountMinor === 25_000_000n);

  // 2. A second pledge from the same number.
  heading("2. a second pledge from the same phone number");
  const second = await pledges.create(db, {
    input: {
      ...base,
      fullName: "Accumulation Test",
      amountKes: 750_000,
      category: "individual",
      tier: "individual_100k_to_1m",
    },
    campaignSlug: CAMPAIGN_SLUG,
  });
  show([
    {
      reference: second.reference,
      amountMinor: second.amountMinor,
      addedMinor: second.addedMinor,
      previousAmountMinor: second.previousAmountMinor,
      isAddition: second.isAddition,
    },
  ]);
  check("the second pledge is flagged as an addition", second.isAddition === true);
  check(
    "the reference is unchanged",
    second.reference === first.reference,
    `${first.reference} -> ${second.reference}`,
  );
  check(
    "the public token is unchanged, so the QR still resolves",
    second.publicToken === first.publicToken,
  );
  check("the pledge id is unchanged", second.pledgeId === first.pledgeId);
  check(
    "the total is the sum of both",
    second.amountMinor === 100_000_000n,
    `${first.amountMinor} + ${second.addedMinor} = ${second.amountMinor}`,
  );
  check("previousAmountMinor is what it was before", second.previousAmountMinor === 25_000_000n);

  // 3. The database, read directly.
  heading("3. what the database holds");
  const rows = await db.execute(sql`
    select p.reference,
           p.amount_minor::text as amount_minor,
           p.status::text as status,
           count(i.id)::int as increments,
           coalesce(sum(i.amount_minor), 0)::text as increments_total,
           string_agg(i.amount_minor::text, ' + ' order by i.created_at, i.id) as parts,
           string_agg(coalesce(i.category, 'null'), ', ' order by i.created_at, i.id) as categories,
           string_agg(coalesce(i.tier, 'null'), ', ' order by i.created_at, i.id) as tiers
    from pledges p
    join pledgers g on g.id = p.pledger_id
    left join pledge_increments i on i.pledge_id = p.id
    where g.phone_e164 = ${phone}
    group by p.id, p.reference, p.amount_minor, p.status
  `);
  show(rows.rows as Record<string, unknown>[]);

  const row = rows.rows[0] as {
    amount_minor: string;
    increments: number;
    increments_total: string;
    categories: string;
    tiers: string;
  };
  check("one pledge row for this phone number", rows.rows.length === 1);
  check("two increments", row?.increments === 2);
  check(
    "the increments sum to the pledge amount",
    row?.increments_total === row?.amount_minor,
    `${row?.increments_total} = ${row?.amount_minor}`,
  );
  check(
    "each increment kept the category it was pledged under",
    row?.categories === "family, individual",
    row?.categories,
  );
  check(
    "each increment kept its tier",
    row?.tiers === "family_below_1m, individual_100k_to_1m",
    row?.tiers,
  );

  // 4. The audit trail.
  heading("4. audit rows");
  const audit = await db.execute(sql`
    select action,
           actor_type,
           before ->> 'amountMinor' as before_amount,
           after  ->> 'previousAmountMinor' as after_previous,
           after  ->> 'addedMinor' as after_added,
           after  ->> 'amountMinor' as after_amount
    from audit_log
    where entity_id = ${first.pledgeId}
    order by id
  `);
  show(audit.rows as Record<string, unknown>[]);
  const actions = (audit.rows as { action: string }[]).map((r) => r.action);
  check(
    "one pledge.created then one pledge.increased",
    actions.join(",") === "pledge.created,pledge.increased",
    actions.join(","),
  );
  const increased = audit.rows[1] as {
    before_amount: string;
    after_previous: string;
    after_added: string;
    after_amount: string;
  };
  check(
    "the increase recorded the previous amount, the addition and the new total",
    increased?.before_amount === "25000000" &&
      increased?.after_previous === "25000000" &&
      increased?.after_added === "75000000" &&
      increased?.after_amount === "100000000",
  );

  // 5. The invariant the trigger holds.
  heading("5. the amount cannot drift from its increments");
  let trigger = false;
  try {
    await db.execute(sql`
      update pledges set amount_minor = amount_minor + 1
      where id = ${first.pledgeId}::uuid
    `);
  } catch (error) {
    trigger = true;
    console.log(`  refused: ${refusal(error)}`);
  }
  check("an amount raised without an increment is refused at commit", trigger);

  const stillRight = await db.execute(sql`
    select p.amount_minor::text as amount_minor,
           coalesce(sum(i.amount_minor), 0)::text as increments_total
    from pledges p
    left join pledge_increments i on i.pledge_id = p.id
    where p.id = ${first.pledgeId}::uuid
    group by p.amount_minor
  `);
  show(stillRight.rows as Record<string, unknown>[]);
  const held = stillRight.rows[0] as {
    amount_minor: string;
    increments_total: string;
  };
  check(
    "the rejected update left nothing behind",
    held?.amount_minor === "100000000" && held?.increments_total === "100000000",
  );

  // 6. Two live pledges for one person are impossible.
  heading("6. one live pledge per person");
  let unique = false;
  try {
    await db.execute(sql`
      insert into pledges (campaign_id, pledger_id, reference, public_token, amount_minor)
      select p.campaign_id, p.pledger_id, next_pledge_reference(), 'verifypartoduplicate0', 100
      from pledges p where p.id = ${first.pledgeId}::uuid
    `);
  } catch (error) {
    unique = true;
    console.log(`  refused: ${refusal(error)}`);
  }
  check("a second live pledge for the same pledger is refused", unique);

  // 7. A finished pledge does not accumulate.
  heading("7. a fulfilled pledge starts a fresh one instead");
  await db.execute(sql`
    update pledges set status = 'fulfilled' where id = ${first.pledgeId}::uuid
  `);
  const third = await pledges.create(db, {
    input: { ...base, amountKes: 100_000 },
    campaignSlug: CAMPAIGN_SLUG,
  });
  show([
    {
      reference: third.reference,
      isAddition: third.isAddition,
      amountMinor: third.amountMinor,
    },
  ]);
  check("a fulfilled pledge is not added to", third.isAddition === false);
  check("it gets its own reference", third.reference !== first.reference);
  // Deliberately left fulfilled. Putting it back to verified would give this
  // pledger two live pledges at once, which the index in step 6 rightly
  // refuses. A fulfilled pledge still counts toward the campaign total, so
  // step 10 is unaffected.

  // 8. Somebody else is unaffected.
  heading("8. a different phone number is a different pledge");
  const other = await pledges.create(db, {
    input: { ...base, phone: otherPhone, fullName: "Someone Else", amountKes: 5_000 },
    campaignSlug: CAMPAIGN_SLUG,
  });
  check("a different number gets its own pledge", other.isAddition === false);
  check("and its own reference", other.reference !== first.reference);

  // 9. Semi annual redemption is now a legal frequency.
  heading("9. the redemption frequencies the column accepts");
  const frequencies = ["monthly", "quarterly", "semi_annually", "annually"];
  for (const frequency of frequencies) {
    let accepted = true;
    try {
      await db.execute(sql`
        update pledges
        set intent = 'installment',
            installment_frequency = ${frequency},
            installment_amount_minor = 1000
        where id = ${other.pledgeId}::uuid
      `);
    } catch {
      accepted = false;
    }
    check(`${frequency} is accepted`, accepted);
  }
  let rejected = false;
  try {
    await db.execute(sql`
      update pledges set installment_frequency = 'fortnightly'
      where id = ${other.pledgeId}::uuid
    `);
  } catch {
    rejected = true;
  }
  check("an unknown frequency is still refused", rejected);

  // 10. The campaign total moved by exactly the accumulated amount.
  heading("10. campaign totals, as a delta");
  await pledges.approve(db, { pledgeId: third.pledgeId });
  await pledges.approve(db, { pledgeId: other.pledgeId });
  const after = await campaign.getTotals(db, { campaignSlug: CAMPAIGN_SLUG });
  const pledgedDelta = after.pledgedMinor - before.pledgedMinor;
  const countDelta = after.pledgeCount - before.pledgeCount;
  show([
    {
      pledged_before: before.pledgedMinor,
      pledged_after: after.pledgedMinor,
      delta: pledgedDelta,
      count_before: before.pledgeCount,
      count_after: after.pledgeCount,
    },
  ]);
  // The accumulated pledge is 100,000,000 minor units, the fresh one after it
  // was fulfilled is 10,000,000, and the other pledger's is 500,000.
  check(
    "pledged rose by the accumulated total, not by each submission separately",
    pledgedDelta === 110_500_000n,
    `${pledgedDelta}`,
  );
  check(
    "four submissions from three people produced three pledges",
    countDelta === 3,
    `${countDelta}`,
  );

  // 11. Clean up.
  heading("11. cleanup");
  await cleanup();
  const final = await campaign.getTotals(db, { campaignSlug: CAMPAIGN_SLUG });
  show([
    {
      pledged: final.pledgedMinor,
      back_to_start: final.pledgedMinor === before.pledgedMinor,
    },
  ]);
  check(
    "totals are back where they started",
    final.pledgedMinor === before.pledgedMinor,
  );
  const orphans = await db.execute(sql`
    select count(*)::int as n
    from pledge_increments i
    left join pledges p on p.id = i.pledge_id
    where p.id is null
  `);
  check(
    "no increments were left behind",
    (orphans.rows[0] as { n: number }).n === 0,
  );

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
