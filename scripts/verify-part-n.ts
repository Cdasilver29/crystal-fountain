import { config } from "dotenv";

import { provisionAdmin, removeVerificationAdmins } from "./verification-admin";

// Load the environment before anything imports src/env.ts.
config({ path: ".env.local" });

/**
 * Audit log verification.
 *
 * Checks the three things this screen has to get right: that only an
 * administrator can open it, that the journal it shows matches the rows in the
 * table, and that paging through it does not skip or repeat an entry.
 *
 * The badge colours are asserted against the exported map rather than against
 * the rendered markup, so a colour cannot be changed without the check that
 * describes it changing too.
 *
 * Usage: pnpm build, pnpm start, then pnpm db:verify:audit
 *
 * Writes nothing to audit_log on purpose, apart from the rows that signing in
 * and being refused naturally produce. Those are real entries about real
 * events and the table is append only, so they stay.
 */

const BASE = process.env.VERIFY_BASE_URL ?? "http://localhost:3000";
const EMAIL = "verify-part-n@example.test";
const PASSWORD = "correct-horse-battery-staple";

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
  const audit = await import("@/server/services/audit");
  const { AUDIT_TONES, toneFor, actorLabel, formatAuditTime } = await import(
    "@/components/admin/audit-table"
  );
  const { AUDIT_FILTER_PREFIXES, AUDIT_FILTERS } = await import(
    "@/server/contracts/admin"
  );

  const failures: string[] = [];
  const check = (label: string, ok: boolean, detail?: string) => {
    if (!ok) failures.push(label);
    console.log(`${ok ? "pass" : "FAIL"}  ${label}${detail ? `  ${detail}` : ""}`);
  };

  await removeVerificationAdmins(db);

  const signIn = async (role: string) => {
    await removeVerificationAdmins(db);
    await provisionAdmin(db, {
      email: EMAIL,
      password: PASSWORD,
      fullName: `Verification ${role}`,
      role,
    });
    const res = await fetch(`${BASE}/api/admin/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
    });
    return res.headers
      .getSetCookie()
      .map((v) => v.split(";")[0])
      .join("; ");
  };

  /* -----------------------------------------------------------------------
   * 1. Who may open it
   * --------------------------------------------------------------------- */

  heading("1. only an administrator may open it");

  const statuses: Record<string, number> = {};
  for (const role of ["viewer", "treasurer", "admin"]) {
    const cookie = await signIn(role);
    const res = await fetch(`${BASE}/admin/audit`, {
      headers: { cookie },
      redirect: "manual",
    });
    statuses[role] = res.status;
  }

  const anon = await fetch(`${BASE}/admin/audit`, { redirect: "manual" });

  show([
    { role: "viewer", status: statuses.viewer },
    { role: "treasurer", status: statuses.treasurer },
    { role: "admin", status: statuses.admin },
    { role: "signed out", status: anon.status },
  ]);

  check("a viewer gets 403", statuses.viewer === 403, String(statuses.viewer));
  check(
    "a treasurer gets 403",
    statuses.treasurer === 403,
    String(statuses.treasurer),
  );
  check("an admin gets 200", statuses.admin === 200, String(statuses.admin));
  check(
    "signed out redirects to the login screen",
    anon.status === 307 || anon.status === 302,
    String(anon.status),
  );

  /*
   * A refusal is itself something the journal should notice. Both refusals
   * above should have left a row naming what was attempted.
   */
  const [{ n: refusals }] = (
    await db.execute(sql`
      select count(*)::int as n from audit_log
      where action = 'admin.forbidden'
        and after->>'attempted' = 'audit.view'
        and at > now() - interval '5 minutes'
    `)
  ).rows as { n: number }[];
  check(
    "and both refusals were recorded in the journal",
    refusals >= 2,
    `${refusals} rows`,
  );

  const cookie = await signIn("admin");
  const as = { headers: { cookie } };

  /* -----------------------------------------------------------------------
   * 2. The journal matches the table
   * --------------------------------------------------------------------- */

  heading("2. the page matches audit_log");

  const first = await audit.listForAdmin(db, { limit: 10 });

  const [{ n: total }] = (
    await db.execute(sql`select count(*)::int as n from audit_log`)
  ).rows as { n: number }[];

  show(
    first.items.slice(0, 6).map((row) => ({
      at: formatAuditTime(row.at),
      actor: actorLabel(row),
      action: row.action,
      tone: toneFor(row.action),
      entity: row.entity,
      detail: row.detail || "(none)",
    })),
  );

  check("the journal has rows to show", total > 0, `${total} in total`);
  check("a page comes back", first.items.length === 10);

  const newestFirst = first.items.every(
    (row, i) => i === 0 || first.items[i - 1].at >= row.at,
  );
  check("ordered newest first", newestFirst);

  const [top] = (
    await db.execute(sql`
      select l.id::text as id, l.action, u.full_name as name
      from audit_log l
      left join admin_users u on u.id = l.actor_id
      order by l.at desc, l.id desc limit 1
    `)
  ).rows as { id: string; action: string; name: string | null }[];

  check(
    "the newest row on the page is the newest row in the table",
    first.items[0].id === top.id && first.items[0].action === top.action,
    `${first.items[0].action} vs ${top.action}`,
  );

  /* -----------------------------------------------------------------------
   * 3. Badge colours
   * --------------------------------------------------------------------- */

  heading("3. badge colours");

  const expected: Record<string, string> = {
    "pledge.created": "green",
    "pledge.approved": "green",
    "payment.recorded": "green",
    "payment.allocated": "green",
    "pledge.fulfilled": "amber",
    "admin.export": "amber",
    "pledge.voided": "red",
    "payment.deallocated": "red",
    "admin.login_failed": "red",
    "admin.login_locked": "red",
    "admin.forbidden": "red",
    "admin.login": "grey",
    "admin.logout": "grey",
    "admin.totp_enrolled": "grey",
  };

  show(
    Object.entries(expected).map(([action, tone]) => ({
      action,
      wanted: tone,
      got: toneFor(action),
    })),
  );

  for (const [action, tone] of Object.entries(expected)) {
    check(`${action} is ${tone}`, toneFor(action) === tone, toneFor(action));
  }

  check(
    "an action nobody has classified falls back to grey",
    toneFor("something.new") === "grey",
  );

  /*
   * Every action actually present in the journal has a colour. This is what
   * catches a service adding an action that then renders as an unexplained
   * grey badge for ever.
   */
  const present = (
    await db.execute(sql`select distinct action from audit_log order by 1`)
  ).rows as { action: string }[];

  const unmapped = present
    .map((r) => r.action)
    .filter((action) => !(action in AUDIT_TONES));

  show([{ actionsInJournal: present.length, unmapped: unmapped.length }]);
  check(
    "every action in the journal has a colour of its own",
    unmapped.length === 0,
    unmapped.join(", ") || "all mapped",
  );

  /* -----------------------------------------------------------------------
   * 4. The detail line
   * --------------------------------------------------------------------- */

  heading("4. the detail line");

  const cases: [string, string, Record<string, unknown> | null, Record<string, unknown> | null, string][] = [
    [
      "a status change reads as a transition",
      "pledge.approved",
      { status: "pending" },
      { status: "verified" },
      "pending → verified",
    ],
    [
      "an allocation names the amount and the pledge",
      "payment.allocated",
      null,
      { amountMinor: "500000", pledgeReference: "CF26-000012" },
      "KES 5,000 allocated to CF26-000012",
    ],
    [
      "a reversal reads off the before side",
      "payment.deallocated",
      { amountMinor: "800000", pledgeReference: "CF26-000170" },
      { reversedAt: "2026-09-09T18:49:04.721Z" },
      "KES 8,000 released from CF26-000170",
    ],
    [
      "an export says how much left the building",
      "admin.export",
      null,
      { rowCount: 42, campaignSlug: "crystal-fountain" },
      "CSV, 42 rows",
    ],
    [
      "a sign in names the account",
      "admin.login",
      null,
      { role: "viewer", email: "x@y.com" },
      "email: x@y.com",
    ],
    [
      "a failed sign in names the account tried",
      "admin.login_failed",
      null,
      { email: "x@y.com" },
      "email: x@y.com",
    ],
    [
      "a refusal says who tried what",
      "admin.forbidden",
      null,
      { role: "viewer", attempted: "export.payments" },
      "viewer attempted export.payments",
    ],
    [
      "a row with nothing in it says nothing",
      "guard.test",
      null,
      null,
      "",
    ],
  ];

  show(
    cases.map(([label, action, before, after, want]) => ({
      action,
      wanted: want || "(empty)",
      got: audit.summarise(action, before, after) || "(empty)",
      ok: audit.summarise(action, before, after) === want,
      label,
    })),
  );

  for (const [label, action, before, after, want] of cases) {
    const got = audit.summarise(action, before, after);
    check(label, got === want, `got "${got}"`);
  }

  /*
   * The payment payload carries the payer's name and phone number. Neither has
   * any business on this screen, and the summary reads named fields precisely
   * so that adding a field to the payload cannot start leaking one.
   */
  const paymentDetail = audit.summarise("payment.recorded", null, {
    method: "mpesa",
    amountMinor: "3200000",
    externalRef: "ABC123",
    payerName: "Grace Mwangi",
    payerPhone: "+254712345678",
  });
  show([{ detail: paymentDetail }]);
  check(
    "a recorded payment shows the amount and reference",
    paymentDetail === "KES 32,000, mpesa, ref ABC123",
    paymentDetail,
  );
  check(
    "and never the payer's phone number or name",
    !paymentDetail.includes("+254712345678") &&
      !paymentDetail.includes("Grace Mwangi"),
  );

  /* -----------------------------------------------------------------------
   * 5. Timestamp and actor
   * --------------------------------------------------------------------- */

  heading("5. timestamp and actor");

  const stamp = formatAuditTime(new Date("2026-09-10T13:32:00.000Z"));
  show([{ utc: "2026-09-10T13:32:00Z", rendered: stamp }]);
  check(
    "a timestamp reads as 10 Sep 2026, 16:32 in Nairobi",
    stamp === "10 Sep 2026, 16:32",
    stamp,
  );

  check(
    "an admin row shows the name",
    actorLabel({ actorType: "admin", actorName: "Grace Mwangi" }) ===
      "Grace Mwangi",
  );
  check(
    "a system row shows System",
    actorLabel({ actorType: "system", actorName: null }) === "System",
  );
  check(
    "an unauthenticated row shows Public",
    actorLabel({ actorType: "public", actorName: null }) === "Public",
  );

  const [{ n: named }] = (
    await db.execute(sql`
      select count(*)::int as n from audit_log l
      join admin_users u on u.id = l.actor_id
      where l.actor_type = 'admin'
    `)
  ).rows as { n: number }[];
  check("admin rows resolve to a real name", named > 0, `${named} rows`);

  /* -----------------------------------------------------------------------
   * 6. Filters
   * --------------------------------------------------------------------- */

  heading("6. filters");

  const counts: Record<string, number> = {};
  for (const filter of AUDIT_FILTERS) {
    const page = await audit.listForAdmin(db, { filter, limit: 200 });
    counts[filter] = page.items.length;

    const prefixes = AUDIT_FILTER_PREFIXES[filter];
    const allMatch =
      prefixes.length === 0 ||
      page.items.every((row) => prefixes.some((p) => row.action.startsWith(p)));
    check(`the ${filter} filter returns only ${filter}`, allMatch);
  }

  show(Object.entries(counts).map(([filter, n]) => ({ filter, rows: n })));

  check(
    "pledges only returns pledge actions",
    counts.pledges > 0 && counts.pledges <= counts.all,
  );
  check("payments returns rows", counts.payments > 0);
  check("auth returns rows", counts.auth > 0);
  check("exports returns rows", counts.exports > 0);

  /* -----------------------------------------------------------------------
   * 7. Search
   * --------------------------------------------------------------------- */

  heading("7. search");

  const byAction = await audit.listForAdmin(db, { q: "login", limit: 50 });
  check(
    "searching an action matches it",
    byAction.items.length > 0 &&
      byAction.items.every((r) => r.action.includes("login")),
    `${byAction.items.length} rows`,
  );

  const [someone] = (
    await db.execute(sql`
      select u.full_name as name from audit_log l
      join admin_users u on u.id = l.actor_id
      where l.actor_type = 'admin' limit 1
    `)
  ).rows as { name: string }[];

  if (someone) {
    const byName = await audit.listForAdmin(db, { q: someone.name, limit: 50 });
    check(
      "searching a name matches that person's rows",
      byName.items.length > 0 &&
        byName.items.every((r) => r.actorName === someone.name),
      `${byName.items.length} rows for ${someone.name}`,
    );
  }

  const nonsense = await audit.listForAdmin(db, { q: "zzzznothing", limit: 50 });
  check("a search that matches nothing returns nothing", nonsense.items.length === 0);

  // A wildcard typed into the box is a character to search for, not a pattern.
  const wildcard = await audit.listForAdmin(db, { q: "%", limit: 50 });
  check(
    "a percent sign is searched for rather than matching everything",
    wildcard.items.length === 0,
    `${wildcard.items.length} rows`,
  );

  /* -----------------------------------------------------------------------
   * 8. Pagination
   * --------------------------------------------------------------------- */

  heading("8. pagination");

  const pageOne = await audit.listForAdmin(db, { limit: 5 });
  check("the first page is full", pageOne.items.length === 5);
  check("and says there is more", pageOne.hasMore && pageOne.nextCursor !== null);

  const pageTwo = await audit.listForAdmin(db, {
    limit: 5,
    cursor: pageOne.nextCursor,
  });
  const pageThree = await audit.listForAdmin(db, {
    limit: 5,
    cursor: pageTwo.nextCursor,
  });

  const ids = [...pageOne.items, ...pageTwo.items, ...pageThree.items].map(
    (r) => r.id,
  );

  show([
    { page: 1, ids: pageOne.items.map((r) => r.id).join(",") },
    { page: 2, ids: pageTwo.items.map((r) => r.id).join(",") },
    { page: 3, ids: pageThree.items.map((r) => r.id).join(",") },
  ]);

  check("no row appears on two pages", new Set(ids).size === ids.length);
  check(
    "the pages are one continuous descending run",
    ids.every((id, i) => i === 0 || BigInt(ids[i - 1]) > BigInt(id)),
  );

  // Fifteen rows read five at a time must be the same fifteen read in one go.
  const straight = await audit.listForAdmin(db, { limit: 15 });
  check(
    "and match the same rows read in one page",
    straight.items.map((r) => r.id).join(",") === ids.join(","),
  );

  const filteredOne = await audit.listForAdmin(db, {
    filter: "pledges",
    limit: 3,
  });
  const filteredTwo = await audit.listForAdmin(db, {
    filter: "pledges",
    limit: 3,
    cursor: filteredOne.nextCursor,
  });
  check(
    "paging keeps the filter applied",
    filteredTwo.items.length > 0 &&
      filteredTwo.items.every((r) => r.action.startsWith("pledge.")),
  );

  check(
    "a rubbish cursor shows the first page rather than failing",
    (await audit.listForAdmin(db, { limit: 5, cursor: "not-a-cursor" })).items[0]
      ?.id === pageOne.items[0].id,
  );

  /* -----------------------------------------------------------------------
   * 9. The page itself
   * --------------------------------------------------------------------- */

  heading("9. /admin/audit");

  const html = await (await fetch(`${BASE}/admin/audit`, as)).text();

  check("it is titled Audit log", html.includes("Audit log"));
  for (const column of ["Timestamp", "Actor", "Action", "Entity", "Detail"]) {
    check(`the ${column} column is there`, html.includes(`>${column}</th>`));
  }
  check(
    "the newest action is on the page",
    html.includes(first.items[0].action),
    first.items[0].action,
  );
  check("the filter dropdown is there", html.includes('id="audit-filter"'));
  check("the search box is there", html.includes('id="audit-search"'));
  check(
    "Audit log is in the admin nav after Analytics",
    html.indexOf('href="/admin/audit"') > html.indexOf('href="/admin/analytics"'),
  );

  const filteredHtml = await (
    await fetch(`${BASE}/admin/audit?filter=exports`, as)
  ).text();
  check(
    "a filter in the URL filters the page",
    filteredHtml.includes("admin.export") &&
      !filteredHtml.includes("pledge.created"),
  );

  const searchedHtml = await (
    await fetch(`${BASE}/admin/audit?q=zzzznothing`, as)
  ).text();
  check(
    "a search matching nothing says so",
    searchedHtml.includes("Nothing in the journal matches that"),
  );

  // The nav link is presentation, but a treasurer should not be shown a door
  // that will not open.
  const treasurerCookie = await signIn("treasurer");
  const treasurerHtml = await (
    await fetch(`${BASE}/admin/payments`, {
      headers: { cookie: treasurerCookie },
    })
  ).text();
  check(
    "a treasurer is not shown the link at all",
    !treasurerHtml.includes('href="/admin/audit"'),
  );

  /* -----------------------------------------------------------------------
   * 10. Cleanup
   * --------------------------------------------------------------------- */

  heading("10. cleanup");
  await removeVerificationAdmins(db);
  console.log("  verification admins removed, audit_log left untouched");

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
