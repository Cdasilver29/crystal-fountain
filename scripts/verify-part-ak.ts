import { config } from "dotenv";

import { provisionAdmin, removeVerificationAdmins } from "./verification-admin";

// Load the environment before anything imports src/env.ts.
config({ path: ".env.local" });

/**
 * Public names that need a second look, session D2.
 *
 * Proves the "Check name" badge, the "Edited" marker and the "Needs review"
 * filter through the real /admin/pledges page, and that the header count under
 * the filter is the filtered total counted in the database, not the rows on
 * screen. The expected figures are worked out here from SQL and the heuristic
 * directly, not from what the page's own service returns.
 *
 * Usage: pnpm build, pnpm start, then pnpm db:verify:name-review
 *
 * Everything it creates is removed at the start and at the end, apart from
 * audit_log rows, which are append only.
 */

const BASE = process.env.VERIFY_BASE_URL ?? "http://localhost:3000";
const CAMPAIGN_SLUG = "crystal-fountain";
const PASSWORD = "correct-horse-battery-staple";
const PHONES = { caps: "0799900141", clean: "0799900142", edited: "0799900143" };

/** Given names no real pledger has, so a search for them finds only these. */
const NAMES = {
  caps: "ZEBEDEEK OTIENOK",
  clean: "Zebedeek Wanjiruk",
  edited: "The Zebedeek Family",
};

function heading(text: string) {
  console.log(`\n== ${text} ==`);
}

/** The page's visible text, with React's text node separators taken out. */
function textOf(html: string): string {
  return html
    .replace(/<!-- -->/g, "")
    .replace(/<script[\s\S]*?<\/script>/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#x27;/g, "'")
    .replace(/\s+/g, " ");
}

function occurrences(text: string, needle: string): number {
  return text.split(needle).length - 1;
}

async function main() {
  const { db } = await import("@/db");
  const { sql } = await import("drizzle-orm");
  const pledges = await import("@/server/services/pledges");
  const { nameNeedsReview } = await import("@/server/display-name-review");
  const { normalizeKenyanPhone } = await import("@/server/contracts/phone");

  const failures: string[] = [];
  const check = (label: string, ok: boolean, detail?: string) => {
    if (!ok) failures.push(label);
    console.log(`${ok ? "pass" : "FAIL"}  ${label}${detail ? `  ${detail}` : ""}`);
  };

  const e164 = {
    caps: normalizeKenyanPhone(PHONES.caps)!,
    clean: normalizeKenyanPhone(PHONES.clean)!,
    edited: normalizeKenyanPhone(PHONES.edited)!,
  };
  const phones = Object.values(e164);

  const wipe = async () => {
    await removeVerificationAdmins(db);
    for (const phone of phones) {
      await db.execute(sql`
        delete from pledges where pledger_id in (
          select id from pledgers where phone_e164 = ${phone}
        )
      `);
      await db.execute(sql`delete from pledgers where phone_e164 = ${phone}`);
    }
  };

  await wipe();

  // 0. Which database this is, read back rather than assumed.
  heading("0. the database under test");
  const target = await db.execute(sql`
    select current_database() as database,
           (select count(*)::int from drizzle.__drizzle_migrations) as migrations,
           (select target_minor::text from campaigns where slug = ${CAMPAIGN_SLUG})
             as target_minor
  `);
  console.table(target.rows);

  // 1. Three consented pledgers: one flagged, one clean, one set by hand.
  heading("1. fixtures");
  const made: Record<keyof typeof NAMES, string> = { caps: "", clean: "", edited: "" };
  for (const key of Object.keys(NAMES) as (keyof typeof NAMES)[]) {
    const pledge = await pledges.create(db, {
      input: {
        fullName: NAMES[key],
        phone: e164[key],
        intent: "one_off" as const,
        amountKes: 50_000,
        recordConsent: true as const,
        contactConsent: false,
        displayConsent: true,
      },
      campaignSlug: CAMPAIGN_SLUG,
    });
    made[key] = pledge.pledgeId;
  }

  const signIn = async (role: "treasurer") => {
    const email = `verify-part-ak-${role}@example.test`;
    await provisionAdmin(db, { email, password: PASSWORD, fullName: `Names ${role}`, role });
    const response = await fetch(`${BASE}/api/admin/login`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: BASE },
      body: JSON.stringify({ email, password: PASSWORD }),
    });
    return response.headers.getSetCookie().join("; ");
  };
  const treasurer = await signIn("treasurer");

  const set = await fetch(`${BASE}/api/admin/pledges/${made.edited}/display-name`, {
    method: "PATCH",
    headers: { cookie: treasurer, "content-type": "application/json", origin: BASE },
    body: JSON.stringify({ publicDisplayName: "The Zebedeek family" }),
  });
  check("the treasurer sets a name by hand", set.status === 200, `${set.status}`);

  const page = async (query: string) => {
    const response = await fetch(`${BASE}/admin/pledges?${query}`, {
      headers: { cookie: treasurer },
      redirect: "manual",
    });
    const html = await response.text();
    return { status: response.status, html, text: textOf(html) };
  };

  // 2. The service picks out the flagged pledger and nobody else.
  heading("2. which pledgers are flagged");
  const ids = await pledges.nameReviewPledgerIds(db);
  const fixtureIds = (
    await db.execute(sql`
      select g.full_name, g.id::text as id from pledgers g
      where g.phone_e164 in (${e164.caps}, ${e164.clean}, ${e164.edited})
    `)
  ).rows as { full_name: string; id: string }[];
  const idOf = (name: string) => fixtureIds.find((row) => row.full_name === name)!.id;
  check("the capitals pledger is flagged", ids.includes(idOf(NAMES.caps)));
  check("the clean pledger is not", !ids.includes(idOf(NAMES.clean)));
  check("the hand set pledger is not", !ids.includes(idOf(NAMES.edited)));

  // 3. The badge and the marker on the unfiltered list.
  heading("3. badge and marker");
  const all = await page("q=Zebedeek");
  check("the page renders for a treasurer", all.status === 200, `${all.status}`);
  check("three fixture rows listed", all.text.includes("3 matching pledges"));
  // Each row renders twice, once as a phone card and once as a table row.
  check("one Check name badge", occurrences(all.text, "Check name") === 2);
  check(
    "its reason is on hover",
    all.html.includes('title="Public name: all capitals"'),
  );
  check("one Edited marker", occurrences(all.text, "Edited") === 2);

  // 4. The filter, and the count under it.
  heading("4. the Needs review filter");
  const review = await page("q=Zebedeek&name=review");
  check("only the flagged row", review.text.includes(NAMES.caps) &&
    !review.text.includes(NAMES.clean) && !review.text.includes(NAMES.edited));
  check("header says 1 matching pledge", review.text.includes("1 matching pledge,"));
  check(
    "the dropdown shows Needs review selected",
    /<option value="review" selected/.test(review.html) ||
      /value="review"[^>]*selected/.test(review.html),
  );

  /*
   * The count for the whole campaign, worked out here: every consented
   * pledger, the heuristic run in this script, and their undeleted pledges
   * counted in SQL.
   */
  const consented = (
    await db.execute(sql`
      select id::text as id, full_name, display_name, display_consent,
             is_organisation, public_display_name
      from pledgers where display_consent
    `)
  ).rows as {
    id: string;
    full_name: string;
    display_name: string | null;
    display_consent: boolean;
    is_organisation: boolean;
    public_display_name: string | null;
  }[];
  const flagged = consented
    .filter((row) =>
      nameNeedsReview({
        storedName: row.display_name ?? row.full_name,
        displayConsent: row.display_consent,
        isOrganisation: row.is_organisation,
        publicDisplayName: row.public_display_name,
      }),
    )
    .map((row) => row.id);
  const expected = (
    await db.execute(sql`
      select count(*)::int as n from pledges p
      join campaigns c on c.id = p.campaign_id
      where c.slug = ${CAMPAIGN_SLUG} and p.deleted_at is null
        and p.pledger_id = any(${`{${flagged.join(",")}}`}::uuid[])
    `)
  ).rows[0] as { n: number };
  const whole = await page("name=review");
  const header = /(\d[\d,]*) matching pledges?,/.exec(whole.text)?.[1];
  console.log(`flagged pledgers ${flagged.length}, their pledges ${expected.n}, header ${header}`);
  check(
    "the header count is the filtered total from the database",
    header !== undefined && Number(header.replace(/,/g, "")) === expected.n,
  );
  check(
    "no unflagged fixture leaks in",
    !whole.text.includes(NAMES.clean) && !whole.text.includes(NAMES.edited),
  );

  // 5. Rubbish in the URL falls back to every name.
  heading("5. an unreadable filter");
  const rubbish = await page("q=Zebedeek&name=nonsense");
  check("falls back to all names", rubbish.text.includes("3 matching pledges"));

  await wipe();

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
