import { config } from "dotenv";

// Load the environment before anything imports src/env.ts.
config({ path: ".env.local" });

/**
 * Targeted commitment redesign verification.
 *
 * The band counts, the ?amount= parameter on /pledge, and the section as it is
 * served. The counts are checked against a second query written differently
 * from the service's, a CASE ladder rather than a range join, so an off by one
 * at a band edge in either shows up as a disagreement.
 *
 * Usage: pnpm build, pnpm start, then pnpm db:verify:commitment
 *
 * Read only. Nothing is written to the database, so it is safe to run against
 * whichever database the server reads.
 */

const BASE = process.env.VERIFY_BASE_URL ?? "http://localhost:3000";
const CAMPAIGN_SLUG = "crystal-fountain";

function heading(text: string) {
  console.log(`\n== ${text} ==`);
}

async function main() {
  const { db } = await import("@/db");
  const { sql } = await import("drizzle-orm");
  const { COMMITMENT_TIERS, PLEDGE_STEPS } = await import("@/content/project");
  const { commitmentBands, BAND_COUNT_PUBLIC_MINIMUM } = await import(
    "@/server/services/campaign"
  );
  const { pledgeAmountParam } = await import("@/server/contracts/pledges");
  const { formatNumber } = await import("@/lib/format");

  const failures: string[] = [];
  const check = (label: string, ok: boolean, detail?: string) => {
    if (!ok) failures.push(label);
    console.log(`${ok ? "pass" : "FAIL"}  ${label}${detail ? `  ${detail}` : ""}`);
  };

  // 1. The bands, two ways.
  heading("1. band counts");
  const floors = COMMITMENT_TIERS.map(
    (tier) => BigInt(tier.pledgePerFamilyKes) * 100n,
  );
  const service = await commitmentBands(db, {
    campaignSlug: CAMPAIGN_SLUG,
    floorsMinor: floors,
  });

  // The floors descend in the content file, so the first one a pledge clears
  // walking down the list is its band.
  const ladder = sql.join(
    floors.map(
      (floor) =>
        sql`when p.amount_minor >= ${floor.toString()}::bigint then ${floor.toString()}`,
    ),
    sql` `,
  );
  const raw = (
    await db.execute(sql`
      select band, count(*)::int as n
      from (
        select case ${ladder} else null end as band
        from pledges p
        join campaigns c on c.id = p.campaign_id
        where c.slug = ${CAMPAIGN_SLUG}
          and p.deleted_at is null
          and p.status in ('verified', 'fulfilled')
      ) banded
      where band is not null
      group by band
    `)
  ).rows as { band: string; n: number }[];
  const rawByFloor = new Map(raw.map((row) => [row.band, Number(row.n)]));

  const rows = COMMITMENT_TIERS.map((tier, index) => {
    const floor = floors[index]!.toString();
    const rawCount = rawByFloor.get(floor) ?? 0;
    return {
      families: tier.families,
      per_family_kes: formatNumber(tier.pledgePerFamilyKes),
      pledges: rawCount,
      shown: service[index]!.pledges ?? "(hidden)",
      expected: rawCount >= BAND_COUNT_PUBLIC_MINIMUM ? rawCount : null,
      got: service[index]!.pledges,
    };
  });
  console.table(
    rows.map(({ families, per_family_kes, pledges, shown }) => ({
      families,
      per_family_kes,
      pledges,
      shown,
    })),
  );
  check(
    "the service agrees with the CASE ladder on every band",
    rows.every((row) => row.expected === row.got),
  );
  check(
    "no band under three is returned as a number",
    service.every((band) => band.pledges === null || band.pledges >= 3),
  );

  // 2. The parameter contract.
  heading("2. the amount parameter");
  const cases: [unknown, number | null][] = [
    ["270000000", 2_700_000],
    ["100000000", 1_000_000],
    ["10000", 100],
    ["100000000000", 1_000_000_000],
    ["100000000100", null],
    ["9900", null],
    ["270000050", null],
    ["abc", null],
    ["1e9", null],
    ["-270000000", null],
    [" 270000000", null],
    ["0270000000", null],
    ["", null],
    [["270000000", "100000000"], null],
    [undefined, null],
  ];
  for (const [input, expected] of cases) {
    const parsed = pledgeAmountParam.safeParse(input);
    const got = parsed.success ? parsed.data : null;
    check(`${JSON.stringify(input)} gives ${expected}`, got === expected);
  }

  // 3. The pledge form as served.
  heading("3. /pledge with an amount");
  const form = async (query: string) =>
    (await fetch(`${BASE}/pledge${query}`)).text();

  const custom = await form("?amount=270000000");
  check(
    "an amount no chip carries fills the custom field",
    /id="amount"[^>]*value="2,700,000"/.test(custom),
  );
  check(
    "and presses no chip",
    !custom.includes('aria-pressed="true"'),
  );

  const chip = await form("?amount=100000000");
  check(
    "an amount a chip carries presses that chip",
    (chip.match(/aria-pressed="true"/g) ?? []).length === 1 &&
      /aria-pressed="true"[\s\S]{0,1200}?>1,000,000</.test(chip),
  );
  check(
    "and fills the field too",
    /id="amount"[^>]*value="1,000,000"/.test(chip),
  );
  check(
    "the form opens on the amount step",
    chip.includes("How much would you like to pledge?"),
  );

  for (const bad of ["abc", "-5", "12345", "999999999999999", "1e9"]) {
    const html = await form(`?amount=${encodeURIComponent(bad)}`);
    check(
      `?amount=${bad} is ignored`,
      /id="amount"[^>]*value=""/.test(html) &&
        !html.includes('aria-pressed="true"'),
    );
  }

  // 4. The home page section.
  heading("4. the home page section");
  const home = await (await fetch(`${BASE}/`)).text();
  const start = home.indexOf("What could your family give?");
  const section = home.slice(start, home.indexOf("</section>", start));
  const collapseAt = section.indexOf('id="all-levels"');

  check("the question heading renders", start !== -1);
  const links = COMMITMENT_TIERS.map((tier) => {
    const href = `/pledge?amount=${BigInt(tier.pledgePerFamilyKes) * 100n}`;
    return { tier, at: section.indexOf(`href="${href}"`) };
  });
  check(
    "every level links to the form with its amount",
    links.every((link) => link.at !== -1),
  );
  check(
    "the three featured levels sit before the collapsed list",
    links
      .filter((link) => link.tier.featured)
      .every((link) => link.at < collapseAt) &&
      links.filter((link) => link.tier.featured).length === 3,
  );
  check(
    "the other six sit inside it",
    links
      .filter((link) => !link.tier.featured)
      .every((link) => link.at > collapseAt),
  );
  check(
    "the collapsed list is inert until opened",
    /id="all-levels"[^>]*inert/.test(section) ||
      /inert[^>]*id="all-levels"/.test(section),
  );
  check("the expand control renders", section.includes("See all nine levels"));
  check(
    "per family is not repeated on the cards",
    !section.includes(">per family<"),
  );

  const shownCounts = [...section.matchAll(/([\d,]+) families at this level/g)]
    .map((match) => Number(match[1]!.replace(/,/g, "")));
  const expectedCounts = rows
    .map((row) => row.expected)
    .filter((count): count is number => count !== null);
  check(
    "a count shows for exactly the bands with three or more",
    JSON.stringify(shownCounts) === JSON.stringify(expectedCounts),
    `shown ${JSON.stringify(shownCounts)}`,
  );

  check(
    "the three steps carry their explanations",
    PLEDGE_STEPS.every((step) => section.includes(step.detail)),
  );

  heading("result");
  if (failures.length > 0) {
    console.log(`${failures.length} check(s) failed:`);
    for (const failure of failures) console.log(`  - ${failure}`);
    process.exit(1);
  }
  console.log("all checks passed");
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
