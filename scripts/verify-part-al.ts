import { config } from "dotenv";

import { provisionAdmin, removeVerificationAdmins } from "./verification-admin";

// Load the environment before anything imports src/env.ts.
config({ path: ".env.local" });

/**
 * The bulk public name review, session D3.
 *
 * Proves /admin/pledges/display-names through the real page and route: a
 * viewer gets 403, flagged rows come first, the progress line counts the hand
 * set names in the database, the "Review public names" button carries the
 * flagged count, and every save and reset the screen makes leaves its own
 * audit row. The keyboard flow is checked in a browser, not here.
 *
 * Usage: pnpm build, pnpm start, then pnpm db:verify:name-bulk
 *
 * Everything it creates is removed at the start and at the end, apart from
 * audit_log rows, which are append only.
 */

const BASE = process.env.VERIFY_BASE_URL ?? "http://localhost:3000";
const CAMPAIGN_SLUG = "crystal-fountain";
const PASSWORD = "correct-horse-battery-staple";
const PHONES = { caps: "0799900151", clean: "0799900152" };

/** Given names no real pledger has. */
const NAMES = { caps: "ZEBEDEEM OTIENOM", clean: "Zebedeem Wanjirum" };

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
  };

  const wipe = async () => {
    await removeVerificationAdmins(db);
    for (const phone of Object.values(e164)) {
      await db.execute(sql`
        delete from pledges where pledger_id in (
          select id from pledgers where phone_e164 = ${phone}
        )
      `);
      await db.execute(sql`delete from pledgers where phone_e164 = ${phone}`);
    }
  };

  await wipe();

  heading("0. the database under test");
  const target = await db.execute(sql`
    select current_database() as database,
           (select count(*)::int from drizzle.__drizzle_migrations) as migrations,
           (select target_minor::text from campaigns where slug = ${CAMPAIGN_SLUG})
             as target_minor
  `);
  console.table(target.rows);

  heading("1. fixtures");
  const made = { caps: "", clean: "" };
  for (const key of ["caps", "clean"] as const) {
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
  const pledgerOf = async (phone: string) =>
    (
      (await db.execute(sql`select id::text as id from pledgers where phone_e164 = ${phone}`))
        .rows[0] as { id: string }
    ).id;
  const capsPledger = await pledgerOf(e164.caps);
  console.log("made two consented pledgers, one in capitals");

  const signIn = async (role: "viewer" | "treasurer" | "admin") => {
    const email = `verify-part-al-${role}@example.test`;
    await provisionAdmin(db, { email, password: PASSWORD, fullName: `Bulk ${role}`, role });
    const response = await fetch(`${BASE}/api/admin/login`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: BASE },
      body: JSON.stringify({ email, password: PASSWORD }),
    });
    return response.headers.getSetCookie().join("; ");
  };
  const cookies = {
    viewer: await signIn("viewer"),
    treasurer: await signIn("treasurer"),
    admin: await signIn("admin"),
  };

  const get = async (cookie: string, path: string) => {
    const response = await fetch(`${BASE}${path}`, {
      headers: { cookie },
      redirect: "manual",
    });
    const html = await response.text();
    return { status: response.status, html, text: textOf(html) };
  };

  heading("2. who can open it");
  const byViewer = await get(cookies.viewer, "/admin/pledges/display-names");
  check("a viewer gets 403", byViewer.status === 403, `${byViewer.status}`);
  const byAdmin = await get(cookies.admin, "/admin/pledges/display-names");
  check("an admin gets 200", byAdmin.status === 200, `${byAdmin.status}`);
  const screen = await get(cookies.treasurer, "/admin/pledges/display-names");
  check("a treasurer gets 200", screen.status === 200, `${screen.status}`);
  const viewerList = await get(cookies.viewer, "/admin/pledges");
  check(
    "a viewer sees no Review public names button",
    !viewerList.text.includes("Review public names"),
  );

  // The population worked out here, not by the page's service.
  const consented = (
    await db.execute(sql`
      select distinct g.id::text as id, g.full_name, g.display_name,
             g.display_consent, g.is_organisation, g.public_display_name
      from pledgers g
      join pledges p on p.pledger_id = g.id and p.deleted_at is null
      join campaigns c on c.id = p.campaign_id
      where c.slug = ${CAMPAIGN_SLUG} and g.display_consent
    `)
  ).rows as {
    id: string;
    full_name: string;
    display_name: string | null;
    display_consent: boolean;
    is_organisation: boolean;
    public_display_name: string | null;
  }[];
  const isFlagged = (row: (typeof consented)[number]) =>
    nameNeedsReview({
      storedName: row.display_name ?? row.full_name,
      displayConsent: row.display_consent,
      isOrganisation: row.is_organisation,
      publicDisplayName: row.public_display_name,
    }) !== null;
  const edited = () => consented.filter((row) => row.public_display_name?.trim()).length;

  heading("3. what the screen shows");
  const progress = /(\d+) of (\d+) reviewed/.exec(screen.text);
  console.log(
    `consented ${consented.length}, hand set ${edited()}, flagged ${consented.filter(isFlagged).length}, page says "${progress?.[0]}"`,
  );
  check(
    "progress line counts hand set names out of every consented pledger",
    progress !== null &&
      Number(progress[1]) === edited() &&
      Number(progress[2]) === consented.length,
  );
  const capsAt = screen.text.indexOf(NAMES.caps);
  const cleanAt = screen.text.indexOf(NAMES.clean);
  check("both fixtures are listed", capsAt >= 0 && cleanAt >= 0);
  check("the flagged row comes before the clean one", capsAt < cleanAt);
  const firstBadge = screen.text.indexOf("Check name");
  const lastBadge = screen.text.lastIndexOf("Check name");
  const firstUnflagged = consented
    .filter((row) => !isFlagged(row))
    .map((row) => screen.text.indexOf(row.display_name ?? row.full_name))
    .filter((at) => at >= 0);
  check(
    "every badge sits above every unflagged row",
    firstBadge >= 0 && firstUnflagged.every((at) => at > lastBadge),
  );
  check(
    "the inputs are prefilled with the rendered name",
    screen.html.includes(`value="ZEBEDEEM O."`),
  );

  heading("4. the button on the pledge list");
  const list = await get(cookies.treasurer, "/admin/pledges");
  const button = /Review public names (\d+) to check/.exec(list.text);
  const flaggedNow = consented.filter(isFlagged).length;
  check(
    "the button carries the flagged count",
    button !== null && Number(button[1]) === flaggedNow,
    `${button?.[1]} vs ${flaggedNow}`,
  );

  heading("5. saves and resets each leave an audit row");
  const auditCount = async () =>
    (
      (await db.execute(sql`
        select count(*)::int as n from audit_log
        where action = 'pledgers.display_name_set' and entity_id = ${capsPledger}
      `)).rows[0] as { n: number }
    ).n;
  const setName = (value: string | null) =>
    fetch(`${BASE}/api/admin/pledges/${made.caps}/display-name`, {
      method: "PATCH",
      headers: {
        cookie: cookies.treasurer,
        "content-type": "application/json",
        origin: BASE,
      },
      body: JSON.stringify({ publicDisplayName: value }),
    });
  const before = await auditCount();
  check("save one", (await setName("Zebedeem O.")).status === 200);
  check("save two", (await setName("Zebedee O.")).status === 200);
  check("reset", (await setName(null)).status === 200);
  const after = await auditCount();
  check("three audit rows written", after - before === 3, `${after - before}`);
  const viewerSave = await fetch(`${BASE}/api/admin/pledges/${made.caps}/display-name`, {
    method: "PATCH",
    headers: { cookie: cookies.viewer, "content-type": "application/json", origin: BASE },
    body: JSON.stringify({ publicDisplayName: "Nope" }),
  });
  check("a viewer cannot save", viewerSave.status === 403, `${viewerSave.status}`);

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
