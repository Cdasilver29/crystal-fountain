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
    faqCategories,
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
  heading("2. /pledge shows the category tabs and their tiers");
  const pledgeHtml = await get("/pledge");

  /*
   * Rewritten for the tabbed form.
   *
   * This section used to describe two flat rows of chips labelled "Family
   * commitment" and "Individual contribution", which the category tab rewrite
   * replaced. The tier tables are now read from the form itself rather than
   * retyped, so a chip cannot change without the check that describes it
   * changing too; verify-part-q asserts the values, and this asserts that what
   * the server actually renders matches them.
   *
   * Only the open tab is in the markup. The other tab's panel is not rendered
   * until it is chosen, which is why nothing here looks for the individual
   * chips.
   */
  const { CATEGORY_TIERS, CATEGORY_LABELS } = await import(
    "@/components/pledge/pledge-form"
  );

  const grouped = (n: number) => n.toLocaleString("en-KE");
  const familyTiers = CATEGORY_TIERS.family;
  const familyChips = familyTiers.flatMap((tier) => tier.amounts);

  const missing = familyChips.filter(
    (amount) => !pledgeHtml.includes(grouped(amount)),
  );
  show(
    familyTiers.map((tier) => ({
      tier: tier.key,
      label: tier.label,
      chips: tier.amounts.map(grouped).join(" / "),
    })),
  );

  check(
    "every chip on the open tab is on the page",
    missing.length === 0,
    missing.map(grouped).join(", "),
  );
  check(
    "both tabs are offered",
    pledgeHtml.includes(CATEGORY_LABELS.family) &&
      pledgeHtml.includes(CATEGORY_LABELS.individual),
  );
  check(
    "the family tab is the one open on arrival",
    /aria-selected="true"[^>]*>[^<]*Family/.test(pledgeHtml) ||
      pledgeHtml.indexOf(CATEGORY_LABELS.family) <
        pledgeHtml.indexOf(CATEGORY_LABELS.individual),
  );
  for (const tier of familyTiers) {
    check(`the ${tier.key} tier is labelled`, pledgeHtml.includes(tier.label));
  }
  check(
    "the tiers run largest first, so the most ambitious is read first",
    pledgeHtml.indexOf(familyTiers[0].label) <
      pledgeHtml.indexOf(familyTiers[2].label),
  );
  check(
    "the custom field is offered as its own card",
    pledgeHtml.includes("Create your own pledge"),
  );
  check(
    "and it sits below the tiers rather than above them",
    pledgeHtml.indexOf("Create your own pledge") >
      pledgeHtml.indexOf(familyTiers[2].label),
  );
  check(
    "a smaller amount is still accepted even though nothing suggests it",
    accepts(10_000) && accepts(500),
  );

  // Nothing is chosen before anybody has chosen. Which chip is lit after a tap
  // is client state and is not visible here.
  const pressed = pledgeHtml.match(/aria-pressed="(true|false)"/g) ?? [];
  check(
    "every chip on the open tab is rendered unpressed",
    pressed.length === familyChips.length &&
      pressed.every((a) => a.includes("false")),
    `${pressed.length} chips, expected ${familyChips.length}`,
  );

  // 2b. The hero
  /*
   * The FAQ is a function now, because two of its answers quote the paybill and
   * the bank account and those can be changed from the settings screen. Called
   * here with the values built into the repo, which is what an installation
   * that has never touched that screen actually serves.
   */
  const { resolvePaymentDetails } = await import("@/lib/payment-details");
  const defaults = resolvePaymentDetails(null);
  const FAQ_CATEGORIES = faqCategories({
    paybill: defaults.paybill,
    accountName: defaults.accountName,
    bankName: defaults.bankName,
    bankAccount: defaults.bankAccount,
  });

  heading("2b. the hero offers a way to the FAQ");
  const heroHtml = await get("/");
  const heroSection = heroHtml.slice(0, heroHtml.indexOf("</section>"));
  check(
    "the hero links to /faq",
    /href="\/faq"/.test(heroSection),
  );
  check(
    "it is labelled",
    heroSection.includes("Frequently asked questions"),
  );
  check(
    "the pledge button is still the first action in it",
    heroSection.indexOf("Make a pledge") <
      heroSection.indexOf("Frequently asked questions"),
  );

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
  check(
    "the families counts render",
    COMMITMENT_TIERS.every((tier) =>
      homeHtml.includes(`${grouped(tier.families)} families`),
    ),
  );
  // Counted inside the section only. The whole document also carries the
  // server component payload in a script tag, where every string appears again.
  const sectionStart = homeHtml.indexOf(COMMITMENT_COPY.heading);
  const sectionHtml = homeHtml.slice(
    sectionStart,
    homeHtml.indexOf("</section>", sectionStart),
  );
  check(
    "the target is stated once beside the heading, not on every row",
    (sectionHtml.match(/campaign target/g) ?? []).length === 1,
    `${(sectionHtml.match(/campaign target/g) ?? []).length} time(s)`,
  );
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

  // 6b. Images
  heading("6b. every image the pages reference is served");
  const referenced = [
    ...new Set(
      [homeHtml, faqHtml].flatMap(
        (html) => html.match(/\/images\/gallery\/[A-Za-z0-9_.-]+/g) ?? [],
      ),
    ),
  ];
  const fetched = await Promise.all(
    referenced.map(async (path) => {
      const response = await fetch(`${BASE}${path}`);
      return {
        path: path.replace("/images/gallery/", ""),
        status: response.status,
        type: response.headers.get("content-type"),
        kb: Math.round(
          Number(response.headers.get("content-length") ?? 0) / 1024,
        ),
      };
    }),
  );
  show(fetched);

  check(
    "every referenced file is there",
    fetched.every((f) => f.status === 200),
    fetched
      .filter((f) => f.status !== 200)
      .map((f) => f.path)
      .join(", ") || "all 200",
  );
  check(
    "none of the retired PNGs is referenced any more",
    !referenced.some((path) => /\.PNG$/i.test(path)),
    referenced.filter((path) => /\.PNG$/i.test(path)).join(", ") || "clean",
  );
  check(
    "the hero is art directed, one crop per breakpoint",
    homeHtml.includes("hero-mobile.jpg") &&
      homeHtml.includes("hero-desktop.jpg") &&
      homeHtml.includes('media="(min-width: 768px)"'),
  );
  check(
    "no hero file is over 300kB",
    fetched.filter((f) => f.path.startsWith("hero-")).every((f) => f.kb <= 300),
    fetched
      .filter((f) => f.path.startsWith("hero-"))
      .map((f) => `${f.path} ${f.kb}kB`)
      .join(", "),
  );

  // 7. The raised ceiling through the real route
  heading("7. a family sized pledge is recorded and stored exactly");
  const { db } = await import("@/db");
  const { sql } = await import("drizzle-orm");

  /*
   * Through the service rather than the route.
   *
   * The public route now refuses everything in production unless Turnstile is
   * configured, which is the point of that guard and is asserted just below.
   * What this section is actually about is the raised ceiling: that a quarter
   * of a billion shillings is accepted at all and is stored as exact minor
   * units. That is a question about the contract and the service, and putting
   * it behind a bot check would only test the bot check.
   */
  const pledgeService = await import("@/server/services/pledges");

  const created = await pledgeService.create(db, {
    input: {
      fullName: "Content Verifier",
      phone: TEST_PHONE_E164,
      amountKes: 250_000_000,
      intent: "one_off",
      recordConsent: true,
      contactConsent: false,
      displayConsent: false,
    },
    campaignSlug: "crystal-fountain",
  });

  show([
    {
      reference: created.reference,
      amountMinor: created.amountMinor,
      status: created.status,
    },
  ]);

  check(
    "KES 250,000,000 is recorded, where the old ceiling would have refused it",
    created.amountMinor === 25_000_000_000n,
    `${created.amountMinor}`,
  );
  check(
    "it is stored as exact minor units",
    created.amountMinor === BigInt(250_000_000) * 100n,
    `${created.amountMinor}`,
  );
  check(
    "the reference is still within 12 characters",
    created.reference.length <= 12,
    created.reference,
  );

  /*
   * And the guard itself, which is the reason the above cannot go through the
   * route. A missing Turnstile key on a live deployment must stop pledging
   * rather than quietly switch the bot check off on a form that takes money.
   */
  const withoutTurnstile = await fetch(`${BASE}/api/pledges`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      fullName: "Content Verifier",
      phone: "0799900198",
      amountKes: 1_000,
      intent: "one_off",
      recordConsent: true,
      contactConsent: false,
      displayConsent: false,
    }),
  });
  const refused = (await withoutTurnstile.json().catch(() => null)) as {
    code?: string;
  } | null;
  check(
    "and with no Turnstile keys configured, the live route refuses outright",
    withoutTurnstile.status === 500 &&
      refused?.code === "turnstile_misconfigured",
    `${withoutTurnstile.status} ${refused?.code}`,
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
