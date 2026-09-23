import { config } from "dotenv";

import { provisionAdmin, removeVerificationAdmins } from "./verification-admin";

// Load the environment before anything imports src/env.ts.
config({ path: ".env.local" });

/**
 * A public display name set by hand, session D1.
 *
 * Proves the override end to end through the real routes: a treasurer sets it,
 * the home feed and /pledgers show it on the next request, the /pledgers search
 * finds it by the name on the page, a reset brings the derived name back, the
 * full name on the record never moves, every change leaves an audit row with
 * the rendered name before and after, and a viewer is refused.
 *
 * Usage: pnpm build, pnpm start, then pnpm db:verify:display-names
 *
 * Everything is read back with SQL or through the public routes rather than
 * from what the admin route claims. Everything it creates is removed at the
 * start and at the end, apart from audit_log rows, which are append only.
 */

const BASE = process.env.VERIFY_BASE_URL ?? "http://localhost:3000";
const CAMPAIGN_SLUG = "crystal-fountain";
const PASSWORD = "correct-horse-battery-staple";
const PHONES = { typo: "0799900131", quiet: "0799900132" };

/** A given name no real pledger has, so the public checks cannot collide. */
const TYPO_NAME = "Zebedeeq Otieno";
const DERIVED = "Zebedeeq O.";
const FIXED = "Zebedee O.";

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
  const { summarise } = await import("@/server/services/audit");
  const { AUDIT_TONES } = await import("@/components/admin/audit-table");
  const { normalizeKenyanPhone } = await import("@/server/contracts/phone");

  const failures: string[] = [];
  const check = (label: string, ok: boolean, detail?: string) => {
    if (!ok) failures.push(label);
    console.log(
      `${ok ? "pass" : "FAIL"}  ${label}${detail ? `  ${detail}` : ""}`,
    );
  };

  const e164 = {
    typo: normalizeKenyanPhone(PHONES.typo)!,
    quiet: normalizeKenyanPhone(PHONES.quiet)!,
  };

  const wipe = async () => {
    await removeVerificationAdmins(db);
    await db.execute(sql`
      delete from pledges where pledger_id in (
        select id from pledgers where phone_e164 in (${e164.typo}, ${e164.quiet})
      )
    `);
    await db.execute(sql`
      delete from pledgers where phone_e164 in (${e164.typo}, ${e164.quiet})
    `);
  };

  await wipe();

  // 0. Which database this is, read back rather than assumed.
  heading("0. the database under test");
  const target = await db.execute(sql`
    select current_database() as database,
           (select count(*)::int from drizzle.__drizzle_migrations) as migrations,
           exists (
             select 1 from information_schema.columns
             where table_name = 'pledgers' and column_name = 'public_display_name'
           ) as has_column
  `);
  show(target.rows as Record<string, unknown>[]);
  const db0 = target.rows[0] as { migrations: number; has_column: boolean };
  check("migration 0016 is applied here", db0.has_column === true);
  if (!db0.has_column) {
    console.error("the column is missing, so nothing below can run");
    process.exit(1);
  }

  const signIn = async (role: "viewer" | "treasurer" | "admin") => {
    await provisionAdmin(db, {
      email: `verify-part-aj-${role}@example.test`,
      password: PASSWORD,
      fullName: `Display ${role}`,
      role,
    });
    const response = await fetch(`${BASE}/api/admin/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: `verify-part-aj-${role}@example.test`,
        password: PASSWORD,
      }),
    });
    return response.headers.getSetCookie().join("; ");
  };

  const cookies = {
    viewer: await signIn("viewer"),
    treasurer: await signIn("treasurer"),
    admin: await signIn("admin"),
  };

  const call = async (cookie: string, path: string, init: RequestInit = {}) => {
    const response = await fetch(`${BASE}${path}`, {
      headers: { cookie, "content-type": "application/json" },
      ...init,
    });
    const text = await response.text();
    let body: Record<string, unknown> | null = null;
    try {
      body = JSON.parse(text) as Record<string, unknown>;
    } catch {
      body = null;
    }
    return { status: response.status, body, text };
  };

  const setName = (cookie: string, pledgeId: string, value: unknown) =>
    call(cookie, `/api/admin/pledges/${pledgeId}/display-name`, {
      method: "PATCH",
      body: JSON.stringify({ publicDisplayName: value }),
    });

  /** The names in the home feed, through the route the band polls. */
  const feedNames = async () => {
    const response = await fetch(`${BASE}/api/campaign/recent`, {
      cache: "no-store",
    });
    const rows = (await response.json()) as { displayName: string }[];
    return rows.map((row) => row.displayName);
  };

  /** The names /pledgers returns for a search, through its own route. */
  const listNames = async (q: string) => {
    const response = await fetch(
      `${BASE}/api/pledges/public?q=${encodeURIComponent(q)}&limit=50`,
      { cache: "no-store" },
    );
    const body = (await response.json()) as {
      entries?: { displayName: string }[];
    };
    return (body.entries ?? []).map((row) => row.displayName);
  };

  const stored = async () => {
    const result = await db.execute(sql`
      select full_name, display_name, public_display_name
      from pledgers where phone_e164 = ${e164.typo}
    `);
    return result.rows[0] as {
      full_name: string;
      display_name: string;
      public_display_name: string | null;
    };
  };

  const auditRows = async (pledgerId: string) => {
    const result = await db.execute(sql`
      select action, actor_id, before, after
      from audit_log
      where entity = 'pledger' and entity_id = ${pledgerId}
        and action = 'pledgers.display_name_set'
      order by at, id
    `);
    return result.rows as {
      action: string;
      actor_id: string | null;
      before: Record<string, unknown>;
      after: Record<string, unknown>;
    }[];
  };

  // 1. A consented pledge with a typo in the name, and one that declined.
  heading("1. a typo on the public list");
  const typo = await pledges.create(db, {
    input: {
      fullName: TYPO_NAME,
      phone: e164.typo,
      intent: "one_off" as const,
      amountKes: 250_000,
      recordConsent: true as const,
      contactConsent: false,
      displayConsent: true,
    },
    campaignSlug: CAMPAIGN_SLUG,
  });
  await pledges.approve(db, { pledgeId: typo.pledgeId, adminId: null });

  const quiet = await pledges.create(db, {
    input: {
      fullName: "Quiet Wambui",
      phone: e164.quiet,
      intent: "one_off" as const,
      amountKes: 100_000,
      recordConsent: true as const,
      contactConsent: false,
      displayConsent: false,
    },
    campaignSlug: CAMPAIGN_SLUG,
  });
  await pledges.approve(db, { pledgeId: quiet.pledgeId, adminId: null });

  const pledgerId = (
    (
      await db.execute(sql`
        select id::text as id from pledgers where phone_e164 = ${e164.typo}
      `)
    ).rows[0] as { id: string }
  ).id;

  const original = await stored();
  show([original]);
  check("no override to begin with", original.public_display_name === null);
  /*
   * Waited for rather than read once. The pledge was made through the service,
   * which clears no cache, so the feed can legitimately serve the list from
   * before it for up to 30 seconds. The admin route below does clear it, which
   * is why the later reads need no wait.
   */
  let feedBefore = await feedNames();
  for (let i = 0; i < 25 && !feedBefore.includes(DERIVED); i++) {
    await new Promise((resolve) => setTimeout(resolve, 2_000));
    feedBefore = await feedNames();
  }
  check("the feed shows the derived, misspelt name", feedBefore.includes(DERIVED));
  check(
    "and so does /pledgers",
    (await listNames("Zebedeeq")).includes(DERIVED),
  );

  // 2. A viewer is refused.
  heading("2. a viewer cannot set it");
  const byViewer = await setName(cookies.viewer, typo.pledgeId, FIXED);
  check("the viewer gets 403", byViewer.status === 403, `${byViewer.status}`);
  check(
    "and nothing was written",
    (await stored()).public_display_name === null,
  );
  const refused = await db.execute(sql`
    select count(*)::int as n from audit_log
    where action = 'admin.forbidden' and entity_id = ${typo.pledgeId}
  `);
  check(
    "the refusal is in the journal",
    (refused.rows[0] as { n: number }).n >= 1,
  );

  // 3. The treasurer sets it.
  heading("3. the treasurer corrects it");
  const set = await setName(cookies.treasurer, typo.pledgeId, `  ${FIXED}  `);
  show([{ status: set.status, ...set.body }]);
  check("accepted", set.status === 200, `${set.status}`);
  check("the response says it changed", set.body?.changed === true);
  check("and what is now shown", set.body?.shownAs === FIXED);

  const afterSet = await stored();
  show([afterSet]);
  check("stored trimmed, exactly as typed", afterSet.public_display_name === FIXED);
  check("the full name is untouched", afterSet.full_name === TYPO_NAME);
  check("the stored display name is untouched", afterSet.display_name === TYPO_NAME);

  // 4. Straight through to the public pages.
  heading("4. the public pages, on the next request");
  const feedAfter = await feedNames();
  check("the feed shows the corrected name", feedAfter.includes(FIXED));
  check("and not the typo", !feedAfter.includes(DERIVED));
  check(
    "/pledgers finds it by the name on the page",
    (await listNames("Zebedee")).includes(FIXED),
  );
  check(
    "and no longer by the typo",
    !(await listNames("Zebedeeq")).some((n) => n === FIXED || n === DERIVED),
  );

  // 5. The journal.
  heading("5. the audit row");
  const rows1 = await auditRows(pledgerId);
  show(rows1.map((r) => ({ ...r, before: JSON.stringify(r.before), after: JSON.stringify(r.after) })));
  check("one row for one change", rows1.length === 1, `${rows1.length}`);
  const first = rows1[0];
  check("it names the treasurer", first?.actor_id !== null);
  check(
    "before carries what was shown",
    first?.before.publicDisplayName === null && first?.before.shownAs === DERIVED,
  );
  check(
    "after carries what is shown now",
    first?.after.publicDisplayName === FIXED && first?.after.shownAs === FIXED,
  );
  const line = summarise("pledgers.display_name_set", first?.before, first?.after);
  console.log(`  detail: ${line}`);
  check(
    "the detail line reads as a sentence",
    line === `${typo.reference}, public name set to "${FIXED}", was "${DERIVED}"`,
  );
  check(
    "and the action has an amber tone",
    (AUDIT_TONES as Record<string, string>)["pledgers.display_name_set"] === "amber",
  );

  // 6. Nothing to write, and nothing allowed.
  heading("6. no ops and refusals");
  const again = await setName(cookies.treasurer, typo.pledgeId, FIXED);
  check("setting the same name changes nothing", again.body?.changed === false);
  check("and writes no audit row", (await auditRows(pledgerId)).length === 1);
  const blank = await setName(cookies.treasurer, typo.pledgeId, "   ");
  check("a blank name is refused", blank.status === 422, `${blank.status}`);
  const long = await setName(cookies.treasurer, typo.pledgeId, "x".repeat(81));
  check("so is one over 80 characters", long.status === 422, `${long.status}`);
  const declined = await setName(cookies.treasurer, quiet.pledgeId, "Quiet W.");
  check(
    "a pledger who is not shown publicly cannot be given a public name",
    declined.status === 409,
    `${declined.status}`,
  );

  // 7. The detail screen.
  heading("7. the pledge screen");
  const page = await call(cookies.treasurer, `/admin/pledges/${typo.pledgeId}`);
  const html = page.text.replace(/<!-- -->/g, "");
  check("it says what is shown publicly", html.includes("Shown publicly as"));
  check("with the hand set name", html.includes(FIXED));
  check("and offers the reset", html.includes("Reset to automatic"));
  const viewerPage = await call(cookies.viewer, `/admin/pledges/${typo.pledgeId}`);
  check(
    "a viewer sees the name and no reset",
    viewerPage.text.includes(FIXED) && !viewerPage.text.includes("Reset to automatic"),
  );
  const quietPage = await call(cookies.treasurer, `/admin/pledges/${quiet.pledgeId}`);
  check(
    "a pledger without consent reads as not shown",
    quietPage.text.includes("Not shown publicly"),
  );

  // 8. Reset by an admin.
  heading("8. reset to automatic");
  const reset = await setName(cookies.admin, typo.pledgeId, null);
  show([{ status: reset.status, ...reset.body }]);
  check("an admin may reset it", reset.status === 200 && reset.body?.changed === true);
  check("the column is null again", (await stored()).public_display_name === null);
  check("the feed shows the derived name again", (await feedNames()).includes(DERIVED));
  check(
    "and /pledgers too",
    (await listNames("Zebedeeq")).includes(DERIVED),
  );
  const rows2 = await auditRows(pledgerId);
  check("a second audit row", rows2.length === 2, `${rows2.length}`);
  const resetLine = summarise("pledgers.display_name_set", rows2[1]?.before, rows2[1]?.after);
  console.log(`  detail: ${resetLine}`);
  check(
    "which reads as a reset to what it went back to",
    resetLine ===
      `${typo.reference}, public name reset to automatic, "${DERIVED}", was "${FIXED}"`,
  );

  // 9. Withdrawing consent takes a hand set name with it.
  heading("9. withdrawing consent");
  await setName(cookies.treasurer, typo.pledgeId, FIXED);
  check("set again", (await stored()).public_display_name === FIXED);
  const withdrawn = await fetch(`${BASE}/api/redeem/display-consent`, {
    method: "DELETE",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ reference: typo.reference, phone: PHONES.typo }),
  });
  check("the withdrawal is accepted", withdrawn.status === 200, `${withdrawn.status}`);
  const afterWithdraw = await stored();
  show([afterWithdraw]);
  check("the override is cleared", afterWithdraw.public_display_name === null);
  check("the full name is still there", afterWithdraw.full_name === TYPO_NAME);
  check("and the feed no longer has it", !(await feedNames()).includes(FIXED));

  // 10. Clean up.
  heading("10. cleanup");
  await wipe();
  const left = await db.execute(sql`
    select count(*)::int as n from pledgers
    where phone_e164 in (${e164.typo}, ${e164.quiet})
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
