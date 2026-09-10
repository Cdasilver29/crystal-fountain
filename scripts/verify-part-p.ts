import { config } from "dotenv";

// Load the environment before anything imports src/env.ts.
config({ path: ".env.local" });

/**
 * Turnstile, auto approval and the per phone rate limit.
 *
 * Proves the four decisions this part added: a submission that clears the bot
 * check and lands under the limit is verified without anybody looking at it, a
 * submission at or above the limit waits for the treasurer, a submission that
 * fails the check is refused outright, and one phone number cannot record more
 * than five pledges an hour.
 *
 * The Cloudflare keys used here are the documented test keys, so this runs
 * against the real siteverify endpoint rather than a stub and proves the wiring
 * as well as the policy:
 * https://developers.cloudflare.com/turnstile/troubleshooting/testing/
 *
 * Usage: pnpm db:verify:turnstile
 *
 * Everything it creates is removed at the end, apart from audit_log rows, which
 * are append only by design.
 */

const CAMPAIGN_SLUG = "crystal-fountain";
const TEST_PHONE = "0799900052";

/** Cloudflare's own test keys. Always passes, always fails, and a dummy token. */
const KEYS_ALWAYS_PASS = {
  siteKey: "1x00000000000000000000AA",
  secretKey: "1x0000000000000000000000000000000AA",
};
const KEYS_ALWAYS_FAIL = {
  siteKey: "2x00000000000000000000AB",
  secretKey: "2x0000000000000000000000000000000AA",
};
const DUMMY_TOKEN = "XXXX.DUMMY.TOKEN.XXXX";

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
  const turnstile = await import("@/server/services/turnstile");
  const { isServiceError } = await import("@/server/errors");
  const { normalizeKenyanPhone } = await import("@/server/contracts/phone");

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

  const before = await campaign.getTotals(db, { campaignSlug: CAMPAIGN_SLUG });

  const base = {
    fullName: "Turnstile Test",
    phone,
    intent: "one_off" as const,
    recordConsent: true as const,
    contactConsent: false,
    displayConsent: false,
  };

  const security = (
    keys: { siteKey: string; secretKey: string },
    limitKes = 5_000_000,
  ) => ({
    token: DUMMY_TOKEN,
    keys,
    bypassAllowed: false,
    autoApproveLimitKes: limitKes,
  });

  const statusOf = async (reference: string) => {
    const row = await db.execute(sql`
      select status::text as status,
             amount_minor::text as amount_minor,
             verified_at is not null as verified
      from pledges where reference = ${reference}
    `);
    return row.rows[0] as {
      status: string;
      amount_minor: string;
      verified: boolean;
    };
  };

  // 1. Configuration is all or nothing.
  heading("1. half a Turnstile configuration is an error");
  check(
    "both keys set counts as configured",
    turnstile.isTurnstileConfigured(KEYS_ALWAYS_PASS) === true,
  );
  check(
    "neither key set counts as not configured",
    turnstile.isTurnstileConfigured({
      siteKey: undefined,
      secretKey: undefined,
    }) === false,
  );
  let halfRefused = false;
  try {
    turnstile.isTurnstileConfigured({
      siteKey: "1x00000000000000000000AA",
      secretKey: "",
    });
  } catch (error) {
    halfRefused = isServiceError(error) && error.code === "turnstile_misconfigured";
  }
  check("a site key with no secret is refused", halfRefused);
  check(
    "the bypass is refused in production",
    turnstile.turnstileBypassAllowed("production") === false,
  );
  check(
    "and allowed outside it",
    turnstile.turnstileBypassAllowed("development") === true,
  );

  // 2. A real round trip to Cloudflare.
  heading("2. Cloudflare siteverify, with the documented test keys");
  const passes = await turnstile.verify({
    token: DUMMY_TOKEN,
    secretKey: KEYS_ALWAYS_PASS.secretKey,
  });
  const fails = await turnstile.verify({
    token: DUMMY_TOKEN,
    secretKey: KEYS_ALWAYS_FAIL.secretKey,
  });
  show([
    { key: "always passes", ok: passes.ok, errorCodes: passes.errorCodes.join(",") || "(none)" },
    { key: "always fails", ok: fails.ok, errorCodes: fails.errorCodes.join(",") || "(none)" },
  ]);
  check("the passing test key verifies", passes.ok === true);
  check("the failing test key does not", fails.ok === false);
  const empty = await turnstile.verify({
    token: "",
    secretKey: KEYS_ALWAYS_PASS.secretKey,
  });
  check(
    "an empty token is refused without a round trip",
    empty.ok === false && empty.errorCodes.includes("missing-input-response"),
  );

  // 3. A failed check refuses the pledge outright.
  heading("3. a failed bot check records nothing");
  let refused: unknown;
  try {
    await pledges.create(db, {
      input: { ...base, amountKes: 1_000 },
      campaignSlug: CAMPAIGN_SLUG,
      security: security(KEYS_ALWAYS_FAIL),
    });
  } catch (error) {
    refused = error;
  }
  check(
    "the submission is refused with turnstile_failed",
    isServiceError(refused) && refused.code === "turnstile_failed",
    isServiceError(refused) ? `${refused.status} ${refused.code}` : String(refused),
  );
  const nothing = await db.execute(sql`
    select count(*)::int as n from pledges p
    join pledgers g on g.id = p.pledger_id
    where g.phone_e164 = ${phone}
  `);
  check(
    "no pledge row was written",
    (nothing.rows[0] as { n: number }).n === 0,
  );

  // 4. Under the limit, verified on the spot.
  heading("4. under the limit, approved without a person");
  const small = await pledges.create(db, {
    input: { ...base, amountKes: 250_000 },
    campaignSlug: CAMPAIGN_SLUG,
    security: security(KEYS_ALWAYS_PASS),
  });
  const smallRow = await statusOf(small.reference);
  show([{ reference: small.reference, ...smallRow, autoApproved: small.autoApproved }]);
  check("the service reports it auto approved", small.autoApproved === true);
  check("the row is verified", smallRow.status === "verified");
  check("and carries a verified_at", smallRow.verified === true);

  // 5. The accumulated total is what gets tested, not the addition.
  heading("5. an addition that crosses the limit is held for review");
  const crossing = await pledges.create(db, {
    input: { ...base, amountKes: 4_800_000 },
    campaignSlug: CAMPAIGN_SLUG,
    security: security(KEYS_ALWAYS_PASS),
  });
  const crossingRow = await statusOf(crossing.reference);
  show([
    {
      reference: crossing.reference,
      total: crossing.amountMinor,
      ...crossingRow,
      autoApproved: crossing.autoApproved,
    },
  ]);
  check("the same reference took the addition", crossing.reference === small.reference);
  check(
    "the total is 5,050,000 shillings, over the limit",
    crossing.amountMinor === 505_000_000n,
  );
  check("so it was not auto approved", crossing.autoApproved === false);
  check(
    "and the pledge is back to pending, waiting for the treasurer",
    crossingRow.status === "pending" && crossingRow.verified === false,
  );

  // 6. A higher limit approves the same total.
  heading("6. the limit is what decides, and it is configurable");
  const raised = await pledges.create(db, {
    input: { ...base, amountKes: 1_000 },
    campaignSlug: CAMPAIGN_SLUG,
    security: security(KEYS_ALWAYS_PASS, 10_000_000),
  });
  const raisedRow = await statusOf(raised.reference);
  show([{ total: raised.amountMinor, ...raisedRow, autoApproved: raised.autoApproved }]);
  check("with a higher limit the same pledge is approved", raised.autoApproved === true);
  check("and the row is verified again", raisedRow.status === "verified");

  // 7. No security context means no auto approval.
  heading("7. a caller with no security context approves nothing");
  await cleanup();
  const plain = await pledges.create(db, {
    input: { ...base, amountKes: 1_000 },
    campaignSlug: CAMPAIGN_SLUG,
  });
  const plainRow = await statusOf(plain.reference);
  check("it is not auto approved", plain.autoApproved === false);
  check("and lands as pending, as it always did", plainRow.status === "pending");

  // 8. Audit rows.
  heading("8. what the audit log says");
  const audit = await db.execute(sql`
    select action,
           actor_type,
           after ->> 'autoApproved' as auto_approved,
           after ->> 'heldForReview' as held_for_review,
           after ->> 'limitMinor' as limit_minor,
           after ->> 'turnstile' as turnstile
    from audit_log
    where entity_id = ${small.pledgeId}
    order by id
  `);
  show(audit.rows as Record<string, unknown>[]);
  const actions = (audit.rows as { action: string }[]).map((r) => r.action);
  /*
   * Three submissions landed on this pledge: the first (step 4, approved), the
   * one that crossed the limit (step 5, held), and the one under a raised limit
   * (step 6, approved). So the journal reads created, approved, increased,
   * increased, approved, and the approval row is absent for exactly the
   * submission that was held.
   */
  check(
    "every approval left its own row, and only an approval did",
    actions.join(",") ===
      "pledge.created,pledge.auto_approved,pledge.increased,pledge.increased,pledge.auto_approved",
    actions.join(","),
  );
  check(
    "two submissions were approved, and the third was not",
    actions.filter((a) => a === "pledge.auto_approved").length === 2,
  );
  check(
    "the held submission is followed by no approval row",
    actions[2] === "pledge.increased" && actions[3] !== "pledge.auto_approved",
  );
  const approvalRow = (audit.rows as { action: string; turnstile: string }[]).find(
    (r) => r.action === "pledge.auto_approved",
  );
  check(
    "and it recorded that Turnstile verified the submission",
    approvalRow?.turnstile === "verified",
  );

  // 9. Five an hour, per phone number.
  heading("9. the rate limit");
  await cleanup();
  for (let i = 0; i < pledges.PLEDGE_RATE_LIMIT; i += 1) {
    await pledges.create(db, {
      input: { ...base, amountKes: 1_000 },
      campaignSlug: CAMPAIGN_SLUG,
      security: security(KEYS_ALWAYS_PASS),
    });
  }
  let limited: unknown;
  try {
    await pledges.create(db, {
      input: { ...base, amountKes: 1_000 },
      campaignSlug: CAMPAIGN_SLUG,
      security: security(KEYS_ALWAYS_PASS),
    });
  } catch (error) {
    limited = error;
  }
  check(
    `submission ${pledges.PLEDGE_RATE_LIMIT + 1} is refused with 429`,
    isServiceError(limited) &&
      limited.code === "pledge_rate_limited" &&
      limited.status === 429,
    isServiceError(limited) ? `${limited.status} ${limited.code}` : String(limited),
  );
  const counted = await db.execute(sql`
    select count(*)::int as n
    from pledge_increments i
    join pledges p on p.id = i.pledge_id
    join pledgers g on g.id = p.pledger_id
    where g.phone_e164 = ${phone}
  `);
  check(
    "the refused submission added no increment",
    (counted.rows[0] as { n: number }).n === pledges.PLEDGE_RATE_LIMIT,
    `${(counted.rows[0] as { n: number }).n} increments`,
  );

  // 10. Clean up.
  heading("10. cleanup");
  await cleanup();
  const final = await campaign.getTotals(db, { campaignSlug: CAMPAIGN_SLUG });
  show([
    {
      pledged_before: before.pledgedMinor,
      pledged_after: final.pledgedMinor,
      back_to_start: final.pledgedMinor === before.pledgedMinor,
    },
  ]);
  check(
    "totals are back where they started",
    final.pledgedMinor === before.pledgedMinor,
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
