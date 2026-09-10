import { config } from "dotenv";

// Load the environment before anything imports src/env.ts.
config({ path: ".env.local" });

/**
 * Category tiers and the redemption plan.
 *
 * Two halves. The tier tables are asserted against the ones the form actually
 * renders, imported from the component rather than retyped here, so a chip
 * cannot be changed without the check that describes it changing too. The
 * redemption half proves the arithmetic and, more importantly, that what the
 * database ends up holding matches what the pledger was shown.
 *
 * Usage: pnpm db:verify:tiers
 *
 * Everything it creates is removed at the end, apart from audit_log rows, which
 * are append only by design.
 */

const CAMPAIGN_SLUG = "crystal-fountain";
const TEST_PHONE = "0799900061";

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
  const { normalizeKenyanPhone } = await import("@/server/contracts/phone");
  const { redemptionSummary } = await import("@/lib/redemption");
  const {
    CATEGORY_TIERS,
    CATEGORY_LABELS,
  } = await import("@/components/pledge/pledge-form");
  const {
    instalmentMinor,
    PLEDGE_TIERS,
    REDEMPTION_CHOICES,
    REDEMPTION_PLANS,
    REDEMPTION_PERIOD_MONTHS,
  } = await import("@/server/contracts/pledges");

  const failures: string[] = [];
  const check = (label: string, ok: boolean, detail?: string) => {
    if (!ok) failures.push(label);
    console.log(
      `${ok ? "pass" : "FAIL"}  ${label}${detail ? `  ${detail}` : ""}`,
    );
  };

  const phone = normalizeKenyanPhone(TEST_PHONE)!;

  const cleanup = async () => {
    await db.execute(sql`
      delete from pledges
      where pledger_id in (select id from pledgers where phone_e164 = ${phone})
    `);
    await db.execute(sql`delete from pledgers where phone_e164 = ${phone}`);
  };

  await cleanup();

  // 1. The chips the form renders.
  heading("1. the tiers, read off the form itself");
  const expected = {
    family: {
      family_above_10m: [10_000_000, 15_000_000, 20_000_000, 50_000_000],
      family_1m_to_10m: [1_000_000, 2_000_000, 3_000_000, 5_000_000, 7_000_000],
      family_below_1m: [100_000, 250_000, 500_000, 750_000],
    },
    individual: {
      individual_above_1m: [1_000_000, 2_000_000, 5_000_000],
      individual_100k_to_1m: [100_000, 250_000, 500_000, 750_000],
      individual_below_100k: [10_000, 25_000, 50_000, 75_000],
    },
  } as const;

  show(
    (["family", "individual"] as const).flatMap((category) =>
      CATEGORY_TIERS[category].map((tier) => ({
        category,
        tier: tier.key,
        label: tier.label,
        range: tier.range,
        chips: tier.amounts.join(" / "),
        premium: Boolean(tier.premium),
      })),
    ),
  );

  for (const category of ["family", "individual"] as const) {
    const tiers = CATEGORY_TIERS[category];
    check(
      `the ${category} tab has three tiers`,
      tiers.length === 3,
      `${tiers.length}`,
    );
    for (const tier of tiers) {
      const want = (expected[category] as Record<string, readonly number[]>)[
        tier.key
      ];
      check(
        `${tier.key} shows the right chips`,
        want !== undefined && tier.amounts.join(",") === want.join(","),
        tier.amounts.join(" / "),
      );
    }
  }

  check(
    "the family tab is labelled for families and groups",
    CATEGORY_LABELS.family === "Family / group pledge",
    CATEGORY_LABELS.family,
  );
  check(
    "only the family landmark tier gets the gold treatment",
    CATEGORY_TIERS.family.filter((t) => t.premium).length === 1 &&
      CATEGORY_TIERS.family[0].premium === true &&
      CATEGORY_TIERS.individual.every((t) => !t.premium),
  );

  const rendered = [
    ...CATEGORY_TIERS.family.map((t) => t.key),
    ...CATEGORY_TIERS.individual.map((t) => t.key),
  ];
  check(
    "every tier the form renders is one the contract accepts",
    rendered.every((key) => (PLEDGE_TIERS as readonly string[]).includes(key)),
    rendered.join(","),
  );
  check(
    "and the contract has exactly those six plus custom",
    PLEDGE_TIERS.length === rendered.length + 1 &&
      (PLEDGE_TIERS as readonly string[]).includes("custom"),
  );

  // 2. The arithmetic behind the breakdown.
  heading("2. the instalment arithmetic");
  const fiveMillion = 500_000_000n;
  show(
    REDEMPTION_CHOICES.map((choice) => ({
      choice,
      instalments: REDEMPTION_PLANS[choice].instalments,
      each: instalmentMinor(fiveMillion, choice),
      summary: redemptionSummary(fiveMillion, choice) ?? "(one payment)",
    })),
  );
  check(
    "the period is 36 months",
    REDEMPTION_PERIOD_MONTHS === 36 &&
      REDEMPTION_PLANS.monthly.instalments === 36 &&
      REDEMPTION_PLANS.quarterly.instalments === 12 &&
      REDEMPTION_PLANS.semi_annually.instalments === 6 &&
      REDEMPTION_PLANS.annually.instalments === 3,
  );
  check(
    "a one off pledge has nothing to divide",
    instalmentMinor(fiveMillion, "one_off") === null &&
      redemptionSummary(fiveMillion, "one_off") === null,
  );
  check(
    "the sentence reads the way the brief wrote it",
    redemptionSummary(fiveMillion, "monthly") ===
      "KES 5,000,000 ÷ 36 months = KES 138,889 per month",
    redemptionSummary(fiveMillion, "monthly") ?? "(null)",
  );
  for (const choice of REDEMPTION_CHOICES) {
    if (choice === "one_off") continue;
    const each = instalmentMinor(fiveMillion, choice)!;
    const instalments = BigInt(REDEMPTION_PLANS[choice].instalments);
    check(
      `${choice} instalments cover the pledge rather than fall short`,
      each * instalments >= fiveMillion,
      `${each} x ${instalments} = ${each * instalments}`,
    );
    check(
      `${choice} is whole shillings`,
      each % 100n === 0n,
      `${each}`,
    );
  }

  // 3. What the database ends up holding.
  heading("3. a pledge with a plan");
  const base = {
    fullName: "Tier Test",
    phone,
    intent: "one_off" as const,
    recordConsent: true as const,
    contactConsent: false,
    displayConsent: false,
  };

  const quarterly = await pledges.create(db, {
    input: {
      ...base,
      amountKes: 5_000_000,
      intent: "installment",
      installmentFrequency: "quarterly",
      category: "family",
      tier: "family_1m_to_10m",
    },
    campaignSlug: CAMPAIGN_SLUG,
  });

  const stored = await db.execute(sql`
    select p.intent,
           p.installment_frequency,
           p.installment_amount_minor::text as installment_amount_minor,
           p.amount_minor::text as amount_minor,
           i.category,
           i.tier
    from pledges p
    join pledge_increments i on i.pledge_id = p.id
    where p.id = ${quarterly.pledgeId}::uuid
  `);
  show(stored.rows as Record<string, unknown>[]);

  const row = stored.rows[0] as {
    intent: string;
    installment_frequency: string;
    installment_amount_minor: string;
    category: string;
    tier: string;
  };
  check("the intent follows the frequency", row.intent === "installment");
  check("the frequency is stored", row.installment_frequency === "quarterly");
  check(
    "the instalment amount is the total divided by twelve quarters",
    row.installment_amount_minor === "41666700",
    `${row.installment_amount_minor} minor units`,
  );
  check("the category is on the increment", row.category === "family");
  check("and so is the tier", row.tier === "family_1m_to_10m");

  // 4. Semi annual, the frequency the column could not hold before.
  heading("4. semi annual, end to end");
  await cleanup();
  const semi = await pledges.create(db, {
    input: {
      ...base,
      amountKes: 1_200_000,
      intent: "installment",
      installmentFrequency: "semi_annually",
      category: "individual",
      tier: "custom",
    },
    campaignSlug: CAMPAIGN_SLUG,
  });
  const semiRow = await db.execute(sql`
    select installment_frequency,
           installment_amount_minor::text as installment_amount_minor
    from pledges where id = ${semi.pledgeId}::uuid
  `);
  show(semiRow.rows as Record<string, unknown>[]);
  check(
    "the database accepts semi_annually",
    (semiRow.rows[0] as { installment_frequency: string })
      .installment_frequency === "semi_annually",
  );
  check(
    "1,200,000 over six payments is 200,000 each",
    (semiRow.rows[0] as { installment_amount_minor: string })
      .installment_amount_minor === "20000000",
  );

  // 5. The plan follows the accumulated total, not the addition.
  heading("5. an addition re-plans the whole pledge");
  const added = await pledges.create(db, {
    input: {
      ...base,
      amountKes: 2_400_000,
      intent: "installment",
      installmentFrequency: "semi_annually",
      category: "individual",
      tier: "custom",
    },
    campaignSlug: CAMPAIGN_SLUG,
  });
  const addedRow = await db.execute(sql`
    select amount_minor::text as amount_minor,
           installment_amount_minor::text as installment_amount_minor
    from pledges where id = ${added.pledgeId}::uuid
  `);
  show(addedRow.rows as Record<string, unknown>[]);
  const after = addedRow.rows[0] as {
    amount_minor: string;
    installment_amount_minor: string;
  };
  check("the same pledge took the addition", added.isAddition === true);
  check("the total is 3,600,000", after.amount_minor === "360000000");
  check(
    "and each payment is now 600,000, planned off the total",
    after.installment_amount_minor === "60000000",
    `${after.installment_amount_minor} minor units`,
  );

  // 6. A one off addition clears the plan.
  heading("6. switching back to one off clears the plan");
  const oneOff = await pledges.create(db, {
    input: { ...base, amountKes: 1_000, category: "individual", tier: "custom" },
    campaignSlug: CAMPAIGN_SLUG,
  });
  const clearedRow = await db.execute(sql`
    select intent,
           installment_frequency,
           installment_amount_minor
    from pledges where id = ${oneOff.pledgeId}::uuid
  `);
  show(clearedRow.rows as Record<string, unknown>[]);
  const cleared = clearedRow.rows[0] as {
    intent: string;
    installment_frequency: string | null;
    installment_amount_minor: string | null;
  };
  check("the intent is one off again", cleared.intent === "one_off");
  check(
    "and both instalment columns are empty",
    cleared.installment_frequency === null &&
      cleared.installment_amount_minor === null,
  );

  // 7. What the confirmation page shows.
  heading("7. the confirmation reads the plan back");
  await cleanup();
  const shown = await pledges.create(db, {
    input: {
      ...base,
      amountKes: 5_000_000,
      intent: "installment",
      installmentFrequency: "monthly",
      category: "family",
      tier: "family_1m_to_10m",
    },
    campaignSlug: CAMPAIGN_SLUG,
  });
  const view = await pledges.getByPublicToken(db, {
    publicToken: shown.publicToken,
  });
  const summary = view?.installmentFrequency
    ? redemptionSummary(view.amountMinor, view.installmentFrequency)
    : null;
  show([
    {
      intent: view?.intent,
      frequency: view?.installmentFrequency,
      instalment: view?.installmentAmountMinor,
      summary,
    },
  ]);
  check(
    "the public view carries the frequency",
    view?.installmentFrequency === "monthly",
  );
  check(
    "and the instalment amount",
    view?.installmentAmountMinor === 13_888_900n,
    `${view?.installmentAmountMinor}`,
  );
  check(
    "the sentence it shows is the one the form showed",
    summary === "KES 5,000,000 ÷ 36 months = KES 138,889 per month",
    summary ?? "(null)",
  );
  check(
    "and it agrees with the stored column",
    view?.installmentAmountMinor ===
      instalmentMinor(view!.amountMinor, "monthly"),
  );

  // 8. Clean up.
  heading("8. cleanup");
  await cleanup();
  const left = await db.execute(sql`
    select count(*)::int as n from pledgers where phone_e164 = ${phone}
  `);
  check(
    "nothing left behind",
    (left.rows[0] as { n: number }).n === 0,
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
