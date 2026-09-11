import { config } from "dotenv";

// Load the environment before anything imports src/env.ts.
config({ path: ".env.local" });

/**
 * The redeem page.
 *
 * Mostly an attack check. The lookup is the one public surface that returns a
 * named individual's giving record, so this proves the pair is genuinely
 * required: that walking references gets nothing, that knowing somebody's phone
 * number gets nothing, that a miss says the same thing however it missed, and
 * that ten attempts a minute is where an address stops.
 *
 * The rest checks that a real pledger gets what they came for, and that the
 * reference reaches the M-Pesa account field.
 *
 * Usage: pnpm build, pnpm start, then pnpm db:verify:redeem
 *
 * Everything it creates is removed at the end, apart from audit_log rows, which
 * are append only by design.
 */

const BASE = process.env.VERIFY_BASE_URL ?? "http://localhost:3000";
const CAMPAIGN_SLUG = "crystal-fountain";
const MINE = "0799900101";
const SOMEBODY_ELSE = "0799900102";

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
  const { lookupPledgeInput } = await import("@/server/contracts/pledges");
  const { isServiceError } = await import("@/server/errors");

  const failures: string[] = [];
  const check = (label: string, ok: boolean, detail?: string) => {
    if (!ok) failures.push(label);
    console.log(
      `${ok ? "pass" : "FAIL"}  ${label}${detail ? `  ${detail}` : ""}`,
    );
  };

  const mine = normalizeKenyanPhone(MINE)!;
  const theirs = normalizeKenyanPhone(SOMEBODY_ELSE)!;

  const cleanup = async () => {
    for (const phone of [mine, theirs]) {
      await db.execute(sql`
        delete from pledges
        where pledger_id in (select id from pledgers where phone_e164 = ${phone})
      `);
      await db.execute(sql`delete from pledgers where phone_e164 = ${phone}`);
    }
    await db.execute(sql`delete from pledge_lookups where ip is null`);
  };

  await cleanup();

  // 1. What the contract will and will not build a query from.
  heading("1. the contract insists on both halves");
  const cases: [string, unknown, boolean][] = [
    ["both, tidy", { reference: "CF26-000124", phone: "0712345678" }, true],
    ["lower case and no dash", { reference: "cf26000124", phone: "0712345678" }, true],
    ["spaces either side", { reference: " CF26-000124 ", phone: "+254 712 345 678" }, true],
    ["reference alone", { reference: "CF26-000124" }, false],
    ["phone alone", { phone: "0712345678" }, false],
    ["empty reference", { reference: "", phone: "0712345678" }, false],
    ["a reference that is not one", { reference: "CF26-12", phone: "0712345678" }, false],
    ["a phone that is not one", { reference: "CF26-000124", phone: "12345" }, false],
  ];
  show(
    cases.map(([label, input, want]) => {
      const parsed = lookupPledgeInput.safeParse(input);
      return {
        label,
        accepted: parsed.success,
        expected: want,
        normalised: parsed.success ? parsed.data.reference : "-",
      };
    }),
  );
  for (const [label, input, want] of cases) {
    const parsed = lookupPledgeInput.safeParse(input);
    check(`${label} is ${want ? "accepted" : "refused"}`, parsed.success === want);
  }
  const tidied = lookupPledgeInput.safeParse({
    reference: "cf26000124",
    phone: "0712345678",
  });
  check(
    "a mistyped reference is repaired rather than rejected",
    tidied.success && tidied.data.reference === "CF26-000124",
    tidied.success ? tidied.data.reference : "(refused)",
  );

  // 2. Two pledges, so one person's details cannot open the other's.
  heading("2. two pledgers");
  const base = {
    intent: "one_off" as const,
    recordConsent: true as const,
    contactConsent: false,
    displayConsent: false,
  };

  const ours = await pledges.create(db, {
    input: {
      ...base,
      fullName: "Grace Wanjiru Mwangi",
      phone: mine,
      amountKes: 500_000,
      intent: "installment",
      installmentFrequency: "quarterly",
    },
    campaignSlug: CAMPAIGN_SLUG,
  });
  await pledges.approve(db, { pledgeId: ours.pledgeId });

  const other = await pledges.create(db, {
    input: { ...base, fullName: "Someone Else", phone: theirs, amountKes: 100_000 },
    campaignSlug: CAMPAIGN_SLUG,
  });
  await pledges.approve(db, { pledgeId: other.pledgeId });

  show([
    { whose: "ours", reference: ours.reference, amount: ours.amountMinor },
    { whose: "theirs", reference: other.reference, amount: other.amountMinor },
  ]);

  const look = (reference: string, phone: string) =>
    pledges.lookup(db, {
      input: { reference, phone },
      campaignSlug: CAMPAIGN_SLUG,
    });

  // 3. The right pair works.
  heading("3. my own reference and my own number");
  const found = await look(ours.reference, mine);
  show([
    {
      firstName: found?.firstName,
      reference: found?.reference,
      pledged: found?.amountMinor,
      paid: found?.paidMinor,
      outstanding: found?.outstandingMinor,
      status: found?.status,
      plan: found?.installmentFrequency,
      instalment: found?.installmentAmountMinor,
    },
  ]);
  check("it finds the pledge", found !== null);
  check("first name only, never the full name", found?.firstName === "Grace");
  check(
    "with the amount, what is paid and what is outstanding",
    found?.amountMinor === 50_000_000n &&
      found?.paidMinor === 0n &&
      found?.outstandingMinor === 50_000_000n,
  );
  check("the status", found?.status === "verified");
  check(
    "and the redemption plan",
    found?.installmentFrequency === "quarterly" &&
      found?.installmentAmountMinor === 4_166_700n,
  );
  check(
    "it hands back the token, which is what a lost reference really needs",
    found?.publicToken === ours.publicToken,
  );

  // 4. Neither half works alone.
  heading("4. one half is never enough");
  const crossed = await look(ours.reference, theirs);
  check(
    "my reference with somebody else's number finds nothing",
    crossed === null,
  );
  const swapped = await look(other.reference, mine);
  check(
    "their reference with my number finds nothing",
    swapped === null,
  );
  const invented = await look("CF26-999999", mine);
  check("a reference that does not exist finds nothing", invented === null);

  // 5. Walking the sequence gets nowhere.
  heading("5. walking CF26-NNNNNN");
  await db.execute(sql`delete from pledge_lookups where ip is null`);
  const digits = Number(ours.reference.slice(5));
  let hits = 0;
  for (let i = digits - 3; i <= digits + 3; i += 1) {
    const reference = `CF26-${String(i).padStart(6, "0")}`;
    // A walker guesses references, not the phone numbers behind them.
    const guess = await look(reference, "+254700000000");
    if (guess !== null) hits += 1;
  }
  check(
    "seven references around a real one, all with a wrong number, return nothing",
    hits === 0,
    `${hits} hits`,
  );

  // 6. The rate limit.
  heading("6. ten attempts a minute");
  await db.execute(sql`delete from pledge_lookups where ip is null`);
  const ip = "203.0.113.42";
  let refused: unknown;
  let allowed = 0;
  for (let i = 0; i < pledges.LOOKUP_RATE_LIMIT + 2; i += 1) {
    try {
      await pledges.lookup(db, {
        input: { reference: "CF26-999999", phone: "+254700000000" },
        campaignSlug: CAMPAIGN_SLUG,
        request: { ip },
      });
      allowed += 1;
    } catch (error) {
      refused = error;
      break;
    }
  }
  check(
    `exactly ${pledges.LOOKUP_RATE_LIMIT} attempts get through`,
    allowed === pledges.LOOKUP_RATE_LIMIT,
    `${allowed}`,
  );
  check(
    "and the next is refused with 429",
    isServiceError(refused) &&
      refused.code === "lookup_rate_limited" &&
      refused.status === 429,
    isServiceError(refused) ? `${refused.status} ${refused.code}` : String(refused),
  );
  const counted = await db.execute(sql`
    select count(*)::int as total,
           count(*) filter (where found)::int as hits
    from pledge_lookups where ip = ${ip}::inet
  `);
  const tally = counted.rows[0] as { total: number; hits: number };
  check(
    "every attempt was recorded",
    tally.total === pledges.LOOKUP_RATE_LIMIT,
    `${tally.total} rows`,
  );
  check(
    "misses are counted too, so finding one pledge does not buy a free walk",
    tally.hits === 0 && tally.total === pledges.LOOKUP_RATE_LIMIT,
    `${tally.hits} of ${tally.total} found anything`,
  );
  const stored = await db.execute(sql`
    select column_name from information_schema.columns
    where table_name = 'pledge_lookups' order by ordinal_position
  `);
  const columns = (stored.rows as { column_name: string }[]).map(
    (r) => r.column_name,
  );
  check(
    "and the limiter stores nothing that says who was looked up",
    columns.join(",") === "id,ip,at,found",
    columns.join(","),
  );
  await db.execute(sql`delete from pledge_lookups where ip = ${ip}::inet`);

  // 7. The endpoint and the page.
  heading("7. over HTTP");
  const post = async (body: unknown) => {
    const response = await fetch(`${BASE}/api/redeem/lookup`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    return { status: response.status, body: await response.text() };
  };

  const hit = await post({ reference: ours.reference, phone: MINE });
  check("a good pair answers 200", hit.status === 200, `${hit.status}`);
  check("with the pledge", hit.body.includes(ours.reference));
  check(
    "and no full name, phone number or email in the payload",
    !hit.body.includes("Mwangi") &&
      !hit.body.includes(mine) &&
      !hit.body.includes(MINE),
  );

  const miss = await post({ reference: ours.reference, phone: SOMEBODY_ELSE });
  check(
    "a wrong pair answers 200 with nothing, not 404",
    miss.status === 200 && JSON.parse(miss.body).pledge === null,
    `${miss.status} ${miss.body}`,
  );
  check(
    "so the response cannot say which half was wrong",
    miss.body === JSON.stringify({ pledge: null }),
    miss.body,
  );

  const get = async (path: string) => {
    const response = await fetch(`${BASE}${path}`, { cache: "no-store" });
    return {
      status: response.status,
      body: (await response.text()).replace(/<!-- -->/g, ""),
    };
  };

  const page = await get("/redeem");
  check("the page is served", page.status === 200, `${page.status}`);
  check("with both sections", page.body.includes("Look up your pledge") && page.body.includes("How to pay"));
  check(
    "and the M-Pesa instruction the brief asked for",
    page.body.includes(
      "use your pledge reference as the account\n            number",
    ) || page.body.includes("use your pledge reference as the account number"),
  );
  check(
    "it says a receipt from the treasurer is the only receipt",
    page.body.includes("only valid receipt"),
  );

  const home = await get("/");
  check(
    "both calls to action are in the nav",
    home.body.includes("Redeem your pledge") && home.body.includes("Make a pledge"),
  );
  /*
   * Each button is found by its own text and then its own class list is read,
   * so this cannot pass merely because both colours appear somewhere on a page
   * that uses them for other things.
   */
  const classesOf = (label: string) =>
    home.body.match(
      new RegExp(`class="([^"]*)"[^>]*>${label}<`),
    )?.[1] ?? "";
  const redeemClasses = classesOf("Redeem your pledge");
  const pledgeClasses = classesOf("Make a pledge");
  check(
    "the redeem button is denim",
    redeemClasses.includes("bg-denim"),
    redeemClasses.slice(0, 40) || "(not found)",
  );
  check(
    "and the pledge button campfire",
    pledgeClasses.includes("bg-campfire"),
    pledgeClasses.slice(0, 40) || "(not found)",
  );
  check(
    "both at the same weight, so neither reads as the lesser option",
    redeemClasses.includes("text-sm font-medium") ===
      pledgeClasses.includes("text-sm font-medium"),
  );

  // 8. Clean up.
  heading("8. cleanup");
  await cleanup();
  const left = await db.execute(sql`
    select count(*)::int as n from pledgers
    where phone_e164 in (${mine}, ${theirs})
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
