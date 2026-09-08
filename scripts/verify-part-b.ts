import { config } from "dotenv";

// Load the environment before anything imports src/env.ts.
config({ path: ".env.local" });

/**
 * Part B verification. Exercises the domain services against the real database
 * and reads the result back with SQL, not application logs.
 *
 * Everything it creates is removed at the end, apart from audit_log rows, which
 * are append only by design.
 */

const CAMPAIGN_SLUG = "crystal-fountain";
const TEST_PHONE_PREFIX = "07999";

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
  const { createPledgeInput } = await import("@/server/contracts/pledges");
  const { isServiceError } = await import("@/server/errors");

  const failures: string[] = [];
  const check = (label: string, ok: boolean) => {
    if (!ok) failures.push(label);
    console.log(`${ok ? "pass" : "FAIL"}  ${label}`);
  };

  // 1. Phone normalisation
  heading("1. phone normalisation, every form of one number");
  const forms = [
    "0712345678",
    "0712 345 678",
    "+254712345678",
    "+254 712-345-678",
    "254712345678",
    "00254712345678",
    "712345678",
  ];
  show(
    forms.map((input) => ({ input, normalized: normalizeKenyanPhone(input) })),
  );
  check(
    "all seven spellings normalise to +254712345678",
    forms.every((f) => normalizeKenyanPhone(f) === "+254712345678"),
  );
  check("01 range is accepted", normalizeKenyanPhone("0112345678") === "+254112345678");
  check("a short number is rejected", normalizeKenyanPhone("07123") === null);
  check("a landline is rejected", normalizeKenyanPhone("0202345678") === null);

  // 2. Contract rejections
  heading("2. contract rejects bad input");
  const badCases: [string, unknown][] = [
    ["amount below the minimum", { amountKes: 50 }],
    ["amount above the maximum", { amountKes: 100_000_001 }],
    ["fractional amount", { amountKes: 100.5 }],
    ["missing record consent", { recordConsent: false }],
    ["one character name", { fullName: "A" }],
  ];
  const base = {
    fullName: "Test Pledger",
    phone: "0712345678",
    amountKes: 25_000,
    intent: "one_off" as const,
    recordConsent: true as const,
    contactConsent: false,
    displayConsent: false,
  };
  for (const [label, patch] of badCases) {
    const result = createPledgeInput.safeParse({ ...base, ...(patch as object) });
    check(`rejected: ${label}`, !result.success);
  }

  // 3. Create a pledge
  heading("3. pledges.create");
  const created = await pledges.create(db, {
    input: createPledgeInput.parse({
      ...base,
      fullName: "Verification Pledger",
      phone: `${TEST_PHONE_PREFIX}00001`,
      email: "verify@example.test",
      displayConsent: true,
    }),
    campaignSlug: CAMPAIGN_SLUG,
    request: { ip: "203.0.113.10", userAgent: "verify-part-b" },
  });
  show([
    {
      reference: created.reference,
      publicToken: created.publicToken,
      amountMinor: created.amountMinor,
      status: created.status,
    },
  ]);
  check("reference matches CF26-NNNNNN", /^CF26-\d{6}$/.test(created.reference));
  check("reference is within 12 characters", created.reference.length <= 12);
  check("public token is 22 characters", created.publicToken.length === 22);
  check("amount is 25000 KES as 2500000 minor", created.amountMinor === 2_500_000n);
  check("new pledge is pending", created.status === "pending");

  // 4. The row, read back with SQL
  heading("4. the database row");
  const row = await db.execute(sql`
    select p.reference, p.public_token, p.amount_minor, p.currency, p.status,
           p.intent, p.channel, g.phone_e164, g.full_name, g.display_name,
           g.display_consent, g.contact_consent, g.privacy_version
    from pledges p join pledgers g on g.id = p.pledger_id
    where p.public_token = ${created.publicToken}
  `);
  show(row.rows as Record<string, unknown>[]);

  // 5. Totals before approval
  heading("5. campaign.getTotals before approval");
  const before = await campaign.getTotals(db, { campaignSlug: CAMPAIGN_SLUG });
  show([{ ...before }]);
  check("a pending pledge does not count toward the total", before.pledgedMinor === 0n);

  // 6. Public view leaks nothing
  heading("6. pledges.getByPublicToken");
  const view = await pledges.getByPublicToken(db, {
    publicToken: created.publicToken,
  });
  show([{ ...view }]);
  const keys = Object.keys(view ?? {});
  check("no phone field is returned", !keys.some((k) => /phone|msisdn/i.test(k)));
  check("no email field is returned", !keys.some((k) => /email/i.test(k)));
  check("consented display name is returned", view?.displayName === "Verification Pledger");
  check(
    "an unknown token returns null",
    (await pledges.getByPublicToken(db, { publicToken: "x".repeat(22) })) === null,
  );

  // 7. Approve
  heading("7. pledges.approve");
  const approved = await pledges.approve(db, {
    pledgeId: created.pledgeId,
    request: { ip: "203.0.113.11", userAgent: "verify-part-b" },
  });
  show([{ ...approved }]);
  check("status is now verified", approved.status === "verified");

  // 8. Totals after approval
  heading("8. campaign.getTotals after approval");
  const after = await campaign.getTotals(db, { campaignSlug: CAMPAIGN_SLUG });
  show([{ ...after }]);
  check(
    "the approved amount is now in the total",
    after.pledgedMinor - before.pledgedMinor === 2_500_000n,
  );
  check("pledge count went up by one", after.pledgeCount === before.pledgeCount + 1);
  check(
    "remaining fell by the same amount",
    before.remainingMinor - after.remainingMinor === 2_500_000n,
  );

  // 9. Invalid transitions
  heading("9. invalid transitions are refused");
  let secondApproval: string | null = null;
  try {
    await pledges.approve(db, { pledgeId: created.pledgeId });
  } catch (error) {
    if (isServiceError(error)) secondApproval = `${error.code}: ${error.message}`;
  }
  console.log(`  approving twice -> ${secondApproval}`);
  check("approving an already verified pledge is refused", secondApproval !== null);

  let missing: string | null = null;
  try {
    await pledges.approve(db, {
      pledgeId: "00000000-0000-0000-0000-000000000000",
    });
  } catch (error) {
    if (isServiceError(error)) missing = error.code;
  }
  check("approving a pledge that does not exist is refused", missing === "pledge_not_found");

  // 10. The reference race
  heading("10. reference generation under concurrency");
  const concurrency = 10;
  const racers = await Promise.all(
    Array.from({ length: concurrency }, (_, i) =>
      pledges.create(db, {
        input: createPledgeInput.parse({
          ...base,
          fullName: `Race Tester ${i}`,
          phone: `${TEST_PHONE_PREFIX}1${String(i).padStart(4, "0")}`,
        }),
        campaignSlug: CAMPAIGN_SLUG,
      }),
    ),
  );
  const references = racers.map((r) => r.reference);
  const tokens = racers.map((r) => r.publicToken);
  console.log(`  ${references.sort().join(", ")}`);
  check(
    `${concurrency} concurrent creates produced ${new Set(references).size} distinct references`,
    new Set(references).size === concurrency,
  );
  check(
    `${concurrency} concurrent creates produced ${new Set(tokens).size} distinct tokens`,
    new Set(tokens).size === concurrency,
  );
  check(
    "every concurrent reference is within 12 characters",
    references.every((r) => r.length <= 12 && /^CF26-\d{6}$/.test(r)),
  );

  // 11. Audit trail
  heading("11. audit_log rows written by this run");
  const audit = await db.execute(sql`
    select action, actor_type, entity, ip, user_agent,
           before ->> 'status' as before_status,
           after  ->> 'status' as after_status,
           after  ->> 'amountMinor' as after_amount_minor
    from audit_log
    where entity_id = ${created.pledgeId}
    order by id
  `);
  show(audit.rows as Record<string, unknown>[]);
  check("create and approve both wrote an audit row", audit.rows.length === 2);

  // 12. Clean up
  heading("12. cleanup");
  await db.execute(sql`
    delete from pledges
    where pledger_id in (
      select id from pledgers where phone_e164 like ${"+2547999%"}
    )
  `);
  await db.execute(sql`delete from pledgers where phone_e164 like ${"+2547999%"}`);
  const final = await campaign.getTotals(db, { campaignSlug: CAMPAIGN_SLUG });
  show([{ ...final }]);
  check("totals are back to zero after cleanup", final.pledgedMinor === 0n);

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
