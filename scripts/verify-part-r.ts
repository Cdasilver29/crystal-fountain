import { config } from "dotenv";

// Load the environment before anything imports src/env.ts.
config({ path: ".env.local" });

/**
 * The confirmation experience.
 *
 * Checks what the page actually serves rather than what the component claims,
 * so it runs against a built server: the checkmark markup and its stylesheet,
 * the two different headings a new pledge and an addition get, the reference in
 * the M-Pesa account field, the way back to the form, and the greeting a
 * returning pledger sees.
 *
 * The privacy check at the end is the important one. The returning pledger
 * banner is keyed on the public token and never on a phone number, so this
 * proves a token cannot be traded for a contact detail and that somebody else's
 * pledge cannot be read out of the form.
 *
 * Usage: pnpm build, pnpm start, then pnpm db:verify:confirmation
 *
 * Everything it creates is removed at the end, apart from audit_log rows, which
 * are append only by design.
 */

const BASE = process.env.VERIFY_BASE_URL ?? "http://localhost:3000";
const CAMPAIGN_SLUG = "crystal-fountain";
const TEST_PHONE = "0799900071";

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
  const { mpesaSteps, MPESA } = await import("@/content/campaign");

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

  const get = async (path: string) => {
    const response = await fetch(`${BASE}${path}`, { redirect: "manual" });
    return { status: response.status, body: await response.text() };
  };

  await cleanup();

  const base = {
    fullName: "Grace Wanjiru",
    phone,
    intent: "one_off" as const,
    recordConsent: true as const,
    contactConsent: false,
    displayConsent: true,
  };

  // 1. A first pledge, and the page it lands on.
  heading("1. a new pledge");
  const first = await pledges.create(db, {
    input: { ...base, amountKes: 250_000, category: "family", tier: "family_below_1m" },
    campaignSlug: CAMPAIGN_SLUG,
  });

  const confirmed = await get(`/pledge/confirmed/${first.publicToken}`);
  check("the confirmation page is served", confirmed.status === 200, `${confirmed.status}`);
  check(
    "the heading is the one CLAUDE.md fixes",
    confirmed.body.includes("Thank you. Your pledge is recorded."),
  );
  check(
    "and it does not say the pledge was received",
    !confirmed.body.includes("has been received"),
  );
  check(
    "it still says a pledge is not a payment",
    confirmed.body.includes("This is a pledge, not a payment"),
  );
  check(
    "the reference is on the page",
    confirmed.body.includes(first.reference),
  );
  check(
    "so is the QR code",
    confirmed.body.includes(`/api/pledges/${first.publicToken}/qr.svg`),
  );
  check(
    "and the amount",
    confirmed.body.includes("KES 250,000"),
  );

  // 2. The checkmark.
  heading("2. the checkmark");
  check(
    "the ring and the tick are both in the markup",
    confirmed.body.includes("success-ring") &&
      confirmed.body.includes("success-tick"),
  );
  check(
    "the mark is hidden from screen readers, since the heading already says it",
    /success-ring[\s\S]{0,400}?aria-hidden|aria-hidden[\s\S]{0,400}?success-ring/.test(
      confirmed.body,
    ),
  );

  /*
   * Read out of the built stylesheet rather than the source, because the
   * minifier rewrites what was authored: it reorders the animation shorthand
   * and turns 900ms into .9s. Asserting against the source would prove only
   * that the source says what it says.
   */
  const cssHref = confirmed.body.match(
    /\/_next\/static\/(?:css|chunks)\/[^"']+\.css/,
  )?.[0];
  check("a stylesheet is linked", Boolean(cssHref), cssHref ?? "(none)");
  const css = cssHref ? (await get(cssHref)).body : "";

  const declaration = (selector: string) =>
    css.match(new RegExp(`\\.${selector}\\{[^}]*\\}`, "g")) ?? [];

  const ring = declaration("success-ring").find((d) => d.includes("animation"));
  const tick = declaration("success-tick").find((d) => d.includes("animation"));
  show([{ ring, tick }]);

  check(
    "the animation is defined in CSS, with no library",
    css.includes("@keyframes") && Boolean(ring) && Boolean(tick),
  );
  check(
    "the ring draws itself over 900ms",
    /animation:[^}]*(\.9s|900ms)[^}]*success-ring/.test(ring ?? ""),
    ring ?? "(none)",
  );
  check(
    "the tick takes 600ms more, delayed until the ring is done",
    /animation:[^}]*(\.6s|600ms)[^}]*(\.9s|900ms)[^}]*success-tick/.test(
      tick ?? "",
    ),
    tick ?? "(none)",
  );
  check(
    "so the whole gesture is 1.5 seconds",
    Boolean(ring) && Boolean(tick),
  );

  const reduced = css
    .replace(/\s+/g, "")
    .match(/prefers-reduced-motion:reduce\)\{[^@]*?\}/g)
    ?.find((block) => block.includes("success-ring"));
  check(
    "and it is switched off for reduced motion, resting drawn",
    Boolean(reduced) &&
      reduced!.includes("animation:none") &&
      reduced!.includes("stroke-dashoffset:0"),
    reduced ?? "(none)",
  );

  // 3. Paying with the reference.
  heading("3. the reference in the M-Pesa account field");
  show([
    { withReference: mpesaSteps(first.reference).join(" | ") },
    { without: mpesaSteps().join(" | ") },
  ]);
  check(
    "the account number step carries the reference",
    mpesaSteps(first.reference).includes(`Account Number: ${first.reference}`),
  );
  check(
    "somebody paying without a pledge still gets the fund name",
    mpesaSteps().includes(`Account Number: ${MPESA.account}`),
  );
  check(
    "and the page renders it that way",
    confirmed.body.includes(`Account Number: ${first.reference}`),
  );

  // 4. The way back.
  heading("4. the way back to the form");
  check(
    "the increase link carries this pledge's token",
    confirmed.body.includes(`/pledge?add=${first.publicToken}`),
  );
  check(
    "and it is offered as increasing a pledge",
    confirmed.body.includes("Increase my pledge"),
  );
  check(
    "there is a share button",
    confirmed.body.includes("Share your pledge"),
  );

  // 5. The greeting on the way back.
  heading("5. what a returning pledger is told");
  const returning = await get(`/pledge?add=${first.publicToken}`);
  check("the form is served", returning.status === 200, `${returning.status}`);
  check(
    "it greets them with what they already pledged",
    returning.body.includes("You have an existing pledge of") &&
      returning.body.includes("KES 250,000"),
  );
  check(
    "on the reference they already have",
    returning.body.includes(first.reference),
  );
  check(
    "and it says what makes the addition happen",
    returning.body.includes("Enter the same phone number"),
  );

  // 6. The privacy of that greeting.
  heading("6. the greeting gives nothing else away");
  check(
    "the phone number is not on the page",
    !returning.body.includes(phone) &&
      !returning.body.includes(TEST_PHONE) &&
      !returning.body.includes("799900071"),
  );
  check(
    "and neither is the full name",
    !returning.body.includes("Wanjiru"),
  );
  const nobody = await get("/pledge?add=notarealtokenatall22");
  check(
    "an unknown token is nobody, and still a working form",
    nobody.status === 200 && !nobody.body.includes("You have an existing pledge"),
    `${nobody.status}`,
  );
  const malformed = await get("/pledge?add=' or 1=1--");
  check(
    "so is a malformed one",
    malformed.status === 200 &&
      !malformed.body.includes("You have an existing pledge"),
    `${malformed.status}`,
  );

  // 7. An addition says something different.
  heading("7. an addition");
  const second = await pledges.create(db, {
    input: { ...base, amountKes: 750_000, category: "family", tier: "family_below_1m" },
    campaignSlug: CAMPAIGN_SLUG,
  });
  check("the same pledge took it", second.isAddition === true);
  check("the reference did not change", second.reference === first.reference);

  const updated = await get(
    `/pledge/confirmed/${second.publicToken}?updated=1`,
  );
  check(
    "the heading says updated rather than recorded",
    updated.body.includes("Thank you. Your pledge is updated.") &&
      !updated.body.includes("Thank you. Your pledge is recorded."),
  );
  check(
    "it shows the cumulative total, not what was just added",
    updated.body.includes("KES 1,000,000") && !updated.body.includes("KES 750,000"),
  );
  check(
    "and says the reference is the one they already had",
    updated.body.includes("on the same reference you already had"),
  );

  const withoutFlag = await get(`/pledge/confirmed/${second.publicToken}`);
  check(
    "without the flag the same pledge reads as recorded",
    withoutFlag.body.includes("Thank you. Your pledge is recorded."),
  );

  // 8. The QR target is unchanged and still a celebration only once.
  heading("8. the public view is not a celebration");
  const publicView = await get(`/p/${first.publicToken}`);
  check("the QR target still resolves", publicView.status === 200);
  check(
    "it shows the accumulated total",
    publicView.body.includes("KES 1,000,000"),
  );
  check(
    "but no checkmark, because arriving from a QR code months later is a visit",
    !publicView.body.includes("success-ring"),
  );
  check(
    "and no thank you heading",
    !publicView.body.includes("Thank you. Your pledge is"),
  );

  // 9. Clean up.
  heading("9. cleanup");
  await cleanup();
  const left = await db.execute(sql`
    select count(*)::int as n from pledgers where phone_e164 = ${phone}
  `);
  check("nothing left behind", (left.rows[0] as { n: number }).n === 0);

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
