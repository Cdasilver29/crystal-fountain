import { config } from "dotenv";
import QRCode from "qrcode";

config({ path: ".env.local" });

/**
 * Part C verification. Drives the route handlers over HTTP against a running
 * server, then reads the result back out of the database.
 *
 * Usage: pnpm build && pnpm start, then pnpm db:verify:api
 */

const BASE = process.env.VERIFY_BASE_URL ?? "http://localhost:3000";
const SITE = process.env.NEXT_PUBLIC_SITE_URL!;
const TEST_PHONE = "0799911111";

const failures: string[] = [];

function check(label: string, ok: boolean, detail?: string) {
  if (!ok) failures.push(label);
  console.log(`${ok ? "pass" : "FAIL"}  ${label}${detail ? `  ${detail}` : ""}`);
}

function heading(text: string) {
  console.log(`\n== ${text} ==`);
}

async function main() {
  const { db } = await import("@/db");
  const { sql } = await import("drizzle-orm");

  /*
   * Cleared before as well as after.
   *
   * This used to tidy up only at the end, which is fine until a run fails
   * partway. The pledger row then survives, and because a second pledge from
   * the same number now accumulates onto the first rather than making a new
   * one, the next run saw ten thousand shillings where it expected five and
   * blamed the route. A suite that cannot be run twice is a suite that reports
   * its own history as a defect.
   */
  const wipe = async () => {
    await db.execute(sql`
      delete from pledges where pledger_id in (
        select id from pledgers where phone_e164 = '+254799911111'
      )
    `);
    await db.execute(
      sql`delete from pledgers where phone_e164 = '+254799911111'`,
    );
  };

  await wipe();

  // 1. Validation is enforced server side
  heading("1. POST /api/pledges rejects bad input");
  const bad = await fetch(`${BASE}/api/pledges`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      fullName: "A",
      phone: "0202345678",
      amountKes: 50,
      intent: "one_off",
      recordConsent: false,
      contactConsent: false,
      displayConsent: false,
    }),
  });
  const badBody = await bad.json();
  check("status is 422", bad.status === 422);
  check(
    "content type is application/problem+json",
    (bad.headers.get("content-type") ?? "").includes("application/problem+json"),
  );
  check("code is validation_failed", badBody.code === "validation_failed");
  console.log("  field errors:", JSON.stringify(badBody.errors));
  check(
    "every bad field is reported",
    ["fullName", "phone", "amountKes", "recordConsent"].every(
      (k) => k in badBody.errors,
    ),
  );

  // 2. A good pledge
  heading("2. a pledge is recorded, and the live route is guarded");

  /*
   * Created through the service, not the route.
   *
   * The public route refuses everything in production unless Turnstile is
   * configured, which is asserted immediately below and is the whole point of
   * that guard. What this section is about is the shape of what comes back: the
   * reference format, the token length, money as minor unit strings, and a
   * pledge landing as pending when nothing has vouched for it. Putting that
   * behind a bot check would only test the bot check.
   */
  const pledgeService = await import("@/server/services/pledges");
  const { normalizeKenyanPhone } = await import("@/server/contracts/phone");

  const result = await pledgeService.create(db, {
    input: {
      fullName: "Api Verification",
      // Normalised here because the service takes a parsed input and this is
      // not going through the route that would have parsed it.
      phone: normalizeKenyanPhone(TEST_PHONE)!,
      email: "api@example.test",
      amountKes: 50_000,
      intent: "one_off",
      recordConsent: true,
      contactConsent: true,
      displayConsent: true,
    },
    campaignSlug: "crystal-fountain",
  });

  const pledge = {
    reference: result.reference,
    publicToken: result.publicToken,
    amountMinor: result.amountMinor.toString(),
    currency: result.currency,
    status: result.status,
  };
  console.table([pledge]);

  check("reference matches CF26-NNNNNN", /^CF26-\d{6}$/.test(pledge.reference));
  check("public token is 22 characters", pledge.publicToken?.length === 22);
  check("amount is minor units as a string", pledge.amountMinor === "5000000");
  check("currency is explicit", pledge.currency === "KES");
  check(
    "a pledge nothing has vouched for is pending",
    pledge.status === "pending",
  );

  /*
   * And the guard itself. A missing Turnstile key on a live deployment must
   * stop pledging rather than quietly switch the bot check off on a form that
   * takes money.
   */
  const guarded = await fetch(`${BASE}/api/pledges`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      fullName: "Api Verification",
      phone: TEST_PHONE,
      amountKes: 50_000,
      intent: "one_off",
      recordConsent: true,
      contactConsent: false,
      displayConsent: false,
    }),
  });
  const guardedBody = (await guarded.json().catch(() => null)) as {
    code?: string;
  } | null;
  check(
    "with no Turnstile keys configured, the live route refuses outright",
    guarded.status === 500 && guardedBody?.code === "turnstile_misconfigured",
    `${guarded.status} ${guardedBody?.code}`,
  );

  const token: string = pledge.publicToken;

  // 3. Lookup by token leaks nothing
  heading("3. GET /api/pledges/:token");
  const detail = await fetch(`${BASE}/api/pledges/${token}`);
  const detailBody = await detail.json();
  console.table([detailBody]);
  check("status is 200", detail.status === 200);
  check("not cached at the edge", detail.headers.get("cache-control") === "no-store");
  const keys = Object.keys(detailBody);
  check("no phone field", !keys.some((k) => /phone|msisdn/i.test(k)));
  check("no email field", !keys.some((k) => /email/i.test(k)));
  check("consented display name is present", detailBody.displayName === "Api Verification");

  const missing = await fetch(`${BASE}/api/pledges/${"z".repeat(22)}`);
  check("unknown token is 404", missing.status === 404);

  // 4. QR encodes exactly the pledge URL and nothing else
  heading("4. GET /api/pledges/:token/qr.svg");
  const qr = await fetch(`${BASE}/api/pledges/${token}/qr.svg`);
  const svg = await qr.text();
  const expectedUrl = `${SITE.replace(/\/$/, "")}/p/${token}`;
  const expectedSvg = await QRCode.toString(expectedUrl, {
    type: "svg",
    errorCorrectionLevel: "M",
    margin: 1,
    width: 512,
    color: { dark: "#052252", light: "#ffffff" },
  });
  console.log(`  encodes: ${expectedUrl}`);
  console.log(`  bytes:   ${svg.length}`);
  check("status is 200", qr.status === 200);
  check(
    "content type is image/svg+xml",
    (qr.headers.get("content-type") ?? "").includes("image/svg+xml"),
  );
  check(
    "cached immutably",
    (qr.headers.get("cache-control") ?? "").includes("immutable"),
  );
  check(
    "the rendered QR is byte identical to a QR of the pledge URL",
    svg === expectedSvg,
  );
  check(
    "the QR carries no personal data",
    !/Api Verification|254799911111|api@example\.test|50000/.test(svg),
  );

  // 5. Campaign summary
  heading("5. GET /api/campaign/summary");
  const summary = await fetch(`${BASE}/api/campaign/summary`);
  const summaryBody = await summary.json();
  console.table([summaryBody]);
  check("status is 200", summary.status === 200);
  check(
    "cached for 30 seconds",
    (summary.headers.get("cache-control") ?? "").includes("s-maxage=30"),
  );
  check("target is the seeded figure", summaryBody.targetMinor === "55000000000");
  check(
    "aggregates only, no personal fields",
    !Object.keys(summaryBody).some((k) => /name|phone|email|reference/i.test(k)),
  );

  // 6. The pages render
  heading("6. pages render");
  for (const [label, path] of [
    ["/pledge", "/pledge"],
    ["/pledge/confirmed/<token>", `/pledge/confirmed/${token}`],
    ["/p/<token>", `/p/${token}`],
  ] as const) {
    const page = await fetch(`${BASE}${path}`);
    const html = await page.text();
    check(`${label} returns 200`, page.status === 200);
    if (path !== "/pledge") {
      check(`${label} shows the reference`, html.includes(pledge.reference));
      check(
        `${label} says a pledge is not a payment`,
        /pledge, not a payment/i.test(html),
      );
      check(
        `${label} does not leak the phone number`,
        !html.includes("254799911111") && !html.includes("api@example.test"),
      );
    }
  }
  const notFound = await fetch(`${BASE}/p/${"z".repeat(22)}`);
  check("/p/<unknown> is 404", notFound.status === 404);

  // 7. Read the row back with SQL
  heading("7. the database row");
  const row = await db.execute(sql`
    select p.reference, p.public_token, p.amount_minor, p.status, p.channel,
           g.phone_e164, g.display_consent, g.contact_consent
    from pledges p join pledgers g on g.id = p.pledger_id
    where p.public_token = ${token}
  `);
  console.table(row.rows as Record<string, unknown>[]);
  check("exactly one row", row.rows.length === 1);
  check(
    "channel recorded as web",
    (row.rows[0] as { channel: string }).channel === "web",
  );

  const audit = await db.execute(sql`
    select action, actor_type, user_agent from audit_log
    where entity_id = (select id from pledges where public_token = ${token})
  `);
  console.table(audit.rows as Record<string, unknown>[]);
  check("an audit row was written", audit.rows.length === 1);

  // 8. Clean up
  heading("8. cleanup");
  await wipe();
  console.log("  test pledge removed");

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
