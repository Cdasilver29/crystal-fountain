import { config } from "dotenv";

// Load the environment before anything imports src/env.ts.
config({ path: ".env.local" });

/**
 * Content and pledge form verification.
 *
 * The two tiers of suggested amounts, the raised ceiling, the accountability
 * copy, the timeline edits and the commitment table. The rendered checks read
 * the served HTML rather than the source, so what is asserted is what a member
 * actually receives: a chip missing from the built page would pass a source
 * grep and fail here.
 *
 * Usage: pnpm build, pnpm start, then pnpm db:verify:content
 *
 * Almost read only. The last section posts one pledge above the old ceiling
 * through the real route, to prove the raised maximum survives the round trip
 * rather than only satisfying the schema in this process, and removes it again.
 * It uses a phone number of its own so the cleanup cannot touch anything else.
 */

/** Belongs to this script and nothing else. Cleanup keys off it. */
const TEST_PHONE_E164 = "+254799922222";

const BASE = process.env.VERIFY_BASE_URL ?? "http://localhost:3000";

/** Copy that must be gone from every page that used to carry it. */
const RETIRED_COPY = [
  "Building Committee",
  "Kenya-Lake Union Conference",
  "Church Development Fund launched",
  "This is My Pledge&quot; covenant launch",
];

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
  const {
    COMMITMENT_TIERS,
    COMMITMENT_COPY,
    PLEDGE_STEPS,
    TIMELINE,
    ACCOUNTABILITY,
    FAQ_CATEGORIES,
  } = await import("@/content/project");
  const { createPledgeInput, MAX_PLEDGE_KES, MIN_PLEDGE_KES } = await import(
    "@/server/contracts/pledges"
  );

  const failures: string[] = [];
  const check = (label: string, ok: boolean, detail?: string) => {
    if (!ok) failures.push(label);
    console.log(`${ok ? "pass" : "FAIL"}  ${label}${detail ? `  ${detail}` : ""}`);
  };

  const get = async (path: string) => {
    const response = await fetch(`${BASE}${path}`);
    if (!response.ok) throw new Error(`${path} returned ${response.status}`);
    return response.text();
  };

  // 1. The contract ceiling
  heading("1. amount contract");
  const base = {
    fullName: "Content Verifier",
    phone: "0712345678",
    intent: "one_off" as const,
    recordConsent: true as const,
    contactConsent: false,
    displayConsent: false,
  };
  const accepts = (amountKes: number) =>
    createPledgeInput.safeParse({ ...base, amountKes }).success;

  show([
    { amountKes: MIN_PLEDGE_KES, accepted: accepts(MIN_PLEDGE_KES) },
    { amountKes: 500, accepted: accepts(500) },
    { amountKes: 10_000_000, accepted: accepts(10_000_000) },
    { amountKes: MAX_PLEDGE_KES, accepted: accepts(MAX_PLEDGE_KES) },
    { amountKes: MAX_PLEDGE_KES + 1, accepted: accepts(MAX_PLEDGE_KES + 1) },
  ]);

  check("the ceiling is KES 1,000,000,000", MAX_PLEDGE_KES === 1_000_000_000);
  check("the floor is still KES 100", MIN_PLEDGE_KES === 100);
  check("KES 500 is accepted", accepts(500));
  check("the largest family chip is accepted", accepts(10_000_000));
  check("the ceiling itself is accepted", accepts(MAX_PLEDGE_KES));
  check("one shilling over the ceiling is rejected", !accepts(MAX_PLEDGE_KES + 1));
  check("KES 99 is still rejected", !accepts(99));

  // 2. The pledge form, as served
  heading("2. /pledge shows both tiers");
  const pledgeHtml = await get("/pledge");

  const family = [1_000_000, 2_000_000, 3_000_000, 5_000_000, 10_000_000];
  const individual = [10_000, 50_000, 100_000, 250_000, 500_000];
  const grouped = (n: number) => n.toLocaleString("en-KE");

  const missing = [...family, ...individual].filter(
    (amount) => !pledgeHtml.includes(grouped(amount)),
  );
  show(
    family.map((amount, index) => ({
      familyChip: grouped(amount),
      individualChip: grouped(individual[index]),
    })),
  );

  check("all ten chips are on the page", missing.length === 0, missing.join(", "));
  check('the family tier is labelled', pledgeHtml.includes("Family commitment"));
  check(
    "the family tier carries the three year label",
    pledgeHtml.includes("Family pledge over 3 years"),
  );
  check(
    "the individual tier is labelled",
    pledgeHtml.includes("Individual contribution") &&
      pledgeHtml.includes("Or choose an amount"),
  );
  check(
    "the custom field is labelled",
    pledgeHtml.includes("Enter your own amount"),
  );
  check(
    "the family tier is rendered before the individual tier",
    pledgeHtml.indexOf("Family commitment") <
      pledgeHtml.indexOf("Individual contribution"),
  );
  check(
    "the custom field is rendered below both tiers",
    pledgeHtml.indexOf("Enter your own amount") >
      pledgeHtml.indexOf("Or choose an amount"),
  );
  check("the old 1,000,000 ceiling chip is now the family floor", family[0] === 1_000_000);

  // 3. Accountability copy
  heading("3. accountability copy");
  const [homeHtml, visionHtml, faqHtml] = await Promise.all([
    get("/"),
    get("/vision"),
    get("/faq"),
  ]);

  check(
    "the oversight paragraph names the Development Committee",
    ACCOUNTABILITY.oversight.includes(
      "overseen by the Development Committee of Newlife Seventh-day Adventist Church working with other departments and church offices",
    ),
  );
  check(
    "the FAQ answer agrees with it",
    FAQ_CATEGORIES.flatMap((category) => category.items).some(
      (item) =>
        item.question === "Who oversees the project?" &&
        item.answer.includes("Development Committee"),
    ),
  );

  for (const [path, html] of [
    ["/", homeHtml],
    ["/vision", visionHtml],
    ["/faq", faqHtml],
  ] as const) {
    const found = RETIRED_COPY.filter((phrase) => html.includes(phrase));
    check(`${path} carries none of the retired copy`, found.length === 0, found.join(", "));
  }

  // 4. Timeline
  heading("4. timeline");
  show(TIMELINE.map((m) => ({ when: m.when, what: m.what, current: m.current ?? false })));

  check(
    "the 5 July 2025 milestone is gone",
    !TIMELINE.some((m) => m.when === "5 July 2025"),
  );
  check(
    "September 2026 is the launch of the Church Development Fund",
    TIMELINE.some(
      (m) => m.when === "September 2026" && m.what === "Launch of Church Development Fund",
    ),
  );
  check("five milestones remain", TIMELINE.length === 5);
  check("exactly one is current", TIMELINE.filter((m) => m.current).length === 1);
  check(
    "the renamed milestone is on the home page",
    homeHtml.includes("Launch of Church Development Fund"),
  );

  // 5. The commitment table
  heading("5. targeted commitment");
  const rows = COMMITMENT_TIERS.map((tier) => ({
    families: tier.families,
    pledgePerFamily: `KES ${grouped(tier.pledgePerFamilyKes)}`,
    sweetSpot: tier.sweetSpot ?? false,
    onPage: homeHtml.includes(`KES ${grouped(tier.pledgePerFamilyKes)}`),
  }));
  show(rows);

  check("nine rows are defined", COMMITMENT_TIERS.length === 9);
  check(
    "every row renders on the home page",
    rows.every((row) => row.onPage),
    `${rows.filter((r) => r.onPage).length} of ${rows.length}`,
  );
  check(
    "two rows are marked as the sweet spot",
    COMMITMENT_TIERS.filter((tier) => tier.sweetSpot).length === 2,
  );
  check("the heading renders", homeHtml.includes(COMMITMENT_COPY.heading));
  check("the subheading renders", homeHtml.includes(COMMITMENT_COPY.subheading));
  check(
    "the three steps render",
    PLEDGE_STEPS.every((step) => homeHtml.includes(`>${step.label}<`)),
  );
  check(
    "the section links to the pledge form",
    homeHtml.includes(COMMITMENT_COPY.ctaLink),
  );
  check(
    "the key numbers block is gone",
    !homeHtml.includes("Main auditorium seats") &&
      !homeHtml.includes("Vision unveiled</span>"),
  );

  // 6. No em dashes in the copy this session touched
  heading("6. copy rules");
  const copy = [
    ACCOUNTABILITY.oversight,
    ACCOUNTABILITY.updates,
    COMMITMENT_COPY.heading,
    COMMITMENT_COPY.subheading,
    COMMITMENT_COPY.cta,
    COMMITMENT_COPY.ctaLink,
    ...TIMELINE.map((m) => `${m.when} ${m.what}`),
    ...FAQ_CATEGORIES.flatMap((c) => c.items).map((i) => `${i.question} ${i.answer}`),
  ];
  const withEmDash = copy.filter((line) => line.includes("—"));
  check("no em dash in any of it", withEmDash.length === 0, withEmDash.join(" | "));

  // 7. The raised ceiling through the real route
  heading("7. POST /api/pledges accepts a family sized pledge");
  const { db } = await import("@/db");
  const { sql } = await import("drizzle-orm");

  const posted = await fetch(`${BASE}/api/pledges`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      fullName: "Content Verifier",
      phone: TEST_PHONE_E164.replace("+254", "0"),
      amountKes: 250_000_000,
      intent: "one_off",
      recordConsent: true,
      contactConsent: false,
      displayConsent: false,
    }),
  });
  const created = await posted.json().catch(() => null);
  show([
    {
      status: posted.status,
      reference: created?.reference ?? null,
      amountMinor: created?.amountMinor ?? null,
    },
  ]);

  check(
    "KES 250,000,000 is recorded, where the old ceiling would have refused it",
    posted.status === 201,
    `status ${posted.status}`,
  );
  check(
    "it is stored as exact minor units",
    created?.amountMinor === "25000000000",
    String(created?.amountMinor),
  );
  check(
    "the reference is still within 12 characters",
    typeof created?.reference === "string" && created.reference.length <= 12,
    created?.reference,
  );

  const tooBig = await fetch(`${BASE}/api/pledges`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      fullName: "Content Verifier",
      phone: TEST_PHONE_E164.replace("+254", "0"),
      amountKes: MAX_PLEDGE_KES + 1,
      intent: "one_off",
      recordConsent: true,
      contactConsent: false,
      displayConsent: false,
    }),
  });
  check(
    "the route still refuses one shilling over the new ceiling",
    tooBig.status === 422,
    `status ${tooBig.status}`,
  );

  await db.execute(sql`
    delete from pledges where pledger_id in (
      select id from pledgers where phone_e164 = ${TEST_PHONE_E164}
    )
  `);
  await db.execute(
    sql`delete from pledgers where phone_e164 = ${TEST_PHONE_E164}`,
  );
  const left = await db.execute(
    sql`select count(*)::int as remaining from pledgers where phone_e164 = ${TEST_PHONE_E164}`,
  );
  show(left.rows as Record<string, unknown>[]);
  check(
    "the test pledge is removed again",
    (left.rows[0] as { remaining: number }).remaining === 0,
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
